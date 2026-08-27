from __future__ import annotations

import datetime
import threading
import uuid
from dataclasses import dataclass
from typing import Iterable, Optional

from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from ..models import Comanda, Item, Lancamento, Mesa
from ..operational_models import (
    AtendimentoComanda,
    AtendimentoMesa,
    LancamentoIdentidade,
    MovimentoAtendimento,
    NumeradorOperacional,
)
from ..timezone_utils import (
    OPERATIONAL_TIMEZONE,
    get_operational_now,
    to_database_utc,
    to_operational_local_time,
)


class AtendimentoError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class PedidoIdentidade:
    atendimento_id: str
    numero_conta: int
    sequencia: int
    label: str


def sequence_to_letters(sequence: int) -> str:
    """1=A, 26=Z, 27=AA. Não existe limite artificial de 26 pedidos."""
    if sequence < 1:
        raise ValueError("A sequência deve ser positiva")
    result = ""
    value = sequence
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result


def format_order_family_id(numero_conta: int, sequence: int) -> str:
    return f"{int(numero_conta)}-{sequence_to_letters(sequence)}"


def _operational_period(dt: Optional[datetime.datetime] = None) -> str:
    local = to_operational_local_time(dt) if dt is not None else get_operational_now()
    return (local or get_operational_now()).strftime("%Y-%m")


def _month_bounds_database(period_ref: str) -> tuple[datetime.datetime, datetime.datetime]:
    year, month = (int(part) for part in period_ref.split("-", 1))
    start = datetime.datetime(year, month, 1, tzinfo=OPERATIONAL_TIMEZONE)
    end = (
        datetime.datetime(year + 1, 1, 1, tzinfo=OPERATIONAL_TIMEZONE)
        if month == 12
        else datetime.datetime(year, month + 1, 1, tzinfo=OPERATIONAL_TIMEZONE)
    )
    return to_database_utc(start), to_database_utc(end)


def _advisory_number_lock(db: Session, restaurante_id: int, period_ref: str) -> None:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        return
    numeric_period = int(period_ref.replace("-", ""))
    key = int(restaurante_id) * 10_000_000 + numeric_period
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def _reserve_legacy_number(
    db: Session,
    restaurante_id: int,
    period_ref: str,
    number: int,
) -> None:
    """Mantém o numerador novo acima dos números humanos legados já existentes."""
    _advisory_number_lock(db, restaurante_id, period_ref)
    counter = (
        db.query(NumeradorOperacional)
        .filter(
            NumeradorOperacional.restaurante_id == restaurante_id,
            NumeradorOperacional.periodo_ref == period_ref,
        )
        .with_for_update()
        .first()
    )
    if counter is None:
        counter = NumeradorOperacional(
            restaurante_id=restaurante_id,
            periodo_ref=period_ref,
            ultimo_numero=number,
        )
        db.add(counter)
    else:
        counter.ultimo_numero = max(int(counter.ultimo_numero or 0), int(number))
    counter.atualizado_em = datetime.datetime.now(datetime.timezone.utc)
    db.flush()


_ALLOCATION_LOCK = threading.Lock()
_IN_MEMORY_MAX_NUMBER: dict[tuple[int, str], int] = {}


def allocate_account_number(
    db: Session,
    restaurante_id: int,
    *,
    opened_at: Optional[datetime.datetime] = None,
) -> tuple[int, str]:
    """Aloca a Conta # humana no mês OPERACIONAL, serializada no PostgreSQL."""
    with _ALLOCATION_LOCK:
        period_ref = _operational_period(opened_at)
        _advisory_number_lock(db, restaurante_id, period_ref)
        counter = (
            db.query(NumeradorOperacional)
            .filter(
                NumeradorOperacional.restaurante_id == restaurante_id,
                NumeradorOperacional.periodo_ref == period_ref,
            )
            .with_for_update()
            .first()
        )
        if counter is None:
            start_db, end_db = _month_bounds_database(period_ref)
            legacy_max = (
                db.query(func.max(Comanda.numero_pedido))
                .filter(
                    Comanda.restaurante_id == restaurante_id,
                    Comanda.criado_em >= start_db,
                    Comanda.criado_em < end_db,
                )
                .scalar()
                or 0
            )
            account_max = (
                db.query(func.max(AtendimentoMesa.numero_conta))
                .filter(
                    AtendimentoMesa.restaurante_id == restaurante_id,
                    AtendimentoMesa.periodo_ref == period_ref,
                )
                .scalar()
                or 0
            )
            counter = NumeradorOperacional(
                restaurante_id=restaurante_id,
                periodo_ref=period_ref,
                ultimo_numero=max(int(legacy_max), int(account_max)),
            )
            db.add(counter)
            try:
                db.flush()
            except Exception:
                db.rollback()
                counter = (
                    db.query(NumeradorOperacional)
                    .filter(
                        NumeradorOperacional.restaurante_id == restaurante_id,
                        NumeradorOperacional.periodo_ref == period_ref,
                    )
                    .with_for_update()
                    .first()
                )
                if counter is None:
                    raise

        mem_key = (restaurante_id, period_ref)
        db_val = int(counter.ultimo_numero or 0)
        current_val = max(db_val, _IN_MEMORY_MAX_NUMBER.get(mem_key, 0))
        next_val = current_val + 1
        counter.ultimo_numero = next_val
        _IN_MEMORY_MAX_NUMBER[mem_key] = next_val
        counter.atualizado_em = datetime.datetime.now(datetime.timezone.utc)
        db.flush()
        return next_val, period_ref


def _record_movement(
    db: Session,
    account: AtendimentoMesa,
    movement_type: str,
    *,
    actor_id: Optional[str] = None,
    origin: Optional[int] = None,
    destination: Optional[int] = None,
    details: Optional[dict] = None,
) -> None:
    db.add(
        MovimentoAtendimento(
            restaurante_id=account.restaurante_id,
            atendimento_id=account.id,
            tipo=movement_type,
            mesa_origem_id=origin,
            mesa_destino_id=destination,
            ator_id=actor_id,
            detalhes=details or None,
        )
    )


def _account_for_comanda(
    db: Session,
    restaurante_id: int,
    comanda_id: str,
    *,
    lock: bool = False,
) -> Optional[AtendimentoMesa]:
    query = (
        db.query(AtendimentoMesa)
        .join(AtendimentoComanda, AtendimentoComanda.atendimento_id == AtendimentoMesa.id)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            AtendimentoComanda.restaurante_id == restaurante_id,
            AtendimentoComanda.comanda_id == comanda_id,
        )
    )
    if lock:
        query = query.with_for_update()
    return query.first()


def _account_by_number(
    db: Session,
    restaurante_id: int,
    period_ref: str,
    numero_conta: int,
    *,
    lock: bool = False,
) -> Optional[AtendimentoMesa]:
    query = db.query(AtendimentoMesa).filter(
        AtendimentoMesa.restaurante_id == restaurante_id,
        AtendimentoMesa.periodo_ref == period_ref,
        AtendimentoMesa.numero_conta == numero_conta,
    )
    if lock:
        query = query.with_for_update()
    return query.first()


def _linked_command_ids(db: Session, restaurante_id: int, atendimento_id: str) -> list[str]:
    return [
        row[0]
        for row in db.query(AtendimentoComanda.comanda_id)
        .filter(
            AtendimentoComanda.restaurante_id == restaurante_id,
            AtendimentoComanda.atendimento_id == atendimento_id,
        )
        .all()
    ]


def lock_table_for_service(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
) -> Mesa:
    """Serializa fluxos de escrita que decidem como ocupar uma mesa.

    A mesa é o registro estável compartilhado por comandas concorrentes. Bloqueá-la
    antes de consultar/criar comandas impede duas requisições de observarem a mesa
    livre ao mesmo tempo. No SQLite o ``FOR UPDATE`` é ignorado, mas a semântica
    continua válida para os testes unitários; a garantia de produção é PostgreSQL.
    """
    mesa = (
        db.query(Mesa)
        .filter(
            Mesa.restaurante_id == restaurante_id,
            Mesa.id == mesa_id,
        )
        .with_for_update()
        .first()
    )
    if mesa is None:
        raise AtendimentoError("Mesa não encontrada", status_code=404)
    return mesa


def materialize_table_accounts_for_write(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    actor_id: Optional[str] = None,
) -> list[AtendimentoMesa]:
    """Materializa identidades apenas dentro de um fluxo mutável explícito."""
    lock_table_for_service(db, restaurante_id, mesa_id)
    commands = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
            Comanda.tipo == "Consumo no Local",
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
        .all()
    )
    accounts = [
        ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
        for command in commands
    ]
    db.flush()
    return accounts


def _sync_account_status(db: Session, account: AtendimentoMesa) -> None:
    command_ids = _linked_command_ids(db, account.restaurante_id, account.id)
    if not command_ids:
        # Uma família sem nenhuma comanda vinculada não representa ocupação
        # real. Registros órfãos podem restar de migrações ou operações antigas
        # e não devem manter uma mesa visualmente livre bloqueada para sempre.
        if account.status != "fechado":
            account.status = "fechado"
            account.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        return
    open_exists = (
        db.query(Comanda.id)
        .filter(
            Comanda.restaurante_id == account.restaurante_id,
            Comanda.id.in_(command_ids),
            Comanda.fechada == False,
        )
        .first()
        is not None
    )
    if open_exists:
        if account.status != "aberto":
            account.status = "aberto"
            account.fechado_em = None
    elif account.status != "fechado":
        account.status = "fechado"
        account.fechado_em = datetime.datetime.now(datetime.timezone.utc)


def reconcile_table_principal(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    actor_id: Optional[str] = None,
) -> Optional[AtendimentoMesa]:
    """Garante exatamente uma família principal entre as famílias abertas da mesa.

    Se a família principal foi paga/fechada e uma família mesclada continua
    aberta, promove a sobrevivente sem renumerar nenhum Pedido # antigo.
    """
    accounts = (
        db.query(AtendimentoMesa)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            AtendimentoMesa.mesa_id == mesa_id,
        )
        .with_for_update()
        .all()
    )
    for account in accounts:
        _sync_account_status(db, account)
    open_accounts = [account for account in accounts if account.status == "aberto"]
    if not open_accounts:
        db.flush()
        return None

    by_id = {account.id: account for account in accounts}
    valid_roots = [
        account
        for account in open_accounts
        if account.principal_id is None
        or account.principal_id not in by_id
        or by_id[account.principal_id].status != "aberto"
        or by_id[account.principal_id].mesa_id != mesa_id
    ]

    if len(valid_roots) > 1:
        # Duas raízes independentes na mesma mesa significam estado legado
        # ambíguo, não uma mesclagem comprovada. Não escolhemos silenciosamente.
        raise AtendimentoError(
            "A mesa possui mais de uma família principal ativa; use Mesclar para reconciliar o atendimento.",
            status_code=409,
        )

    root = valid_roots[0] if valid_roots else None
    if root is None:
        # Todos os abertos apontam para uma raiz já fechada. Como o sistema
        # atualmente limita o grupo a duas famílias, a sobrevivente é inequívoca.
        root = min(open_accounts, key=lambda account: (account.criado_em, account.id))

    if root.principal_id is not None:
        previous_parent = root.principal_id
        root.principal_id = None
        _record_movement(
            db,
            root,
            "promocao_principal",
            actor_id=actor_id,
            origin=mesa_id,
            destination=mesa_id,
            details={"principal_anterior": previous_parent},
        )

    for account in open_accounts:
        if account.id == root.id:
            continue
        parent = by_id.get(account.principal_id) if account.principal_id else None
        if parent is None or parent.status != "aberto" or parent.mesa_id != mesa_id:
            account.principal_id = root.id
    db.flush()
    return root


def _new_account(
    db: Session,
    comanda: Comanda,
    *,
    actor_id: Optional[str],
    principal: Optional[AtendimentoMesa],
) -> AtendimentoMesa:
    period_ref = _operational_period(comanda.criado_em)
    legacy_number = int(comanda.numero_pedido or 0)
    existing_number = (
        _account_by_number(db, comanda.restaurante_id, period_ref, legacy_number)
        if legacy_number > 0
        else None
    )
    if legacy_number > 0 and existing_number is None:
        number = legacy_number
        _reserve_legacy_number(db, comanda.restaurante_id, period_ref, number)
    else:
        number, period_ref = allocate_account_number(
            db,
            comanda.restaurante_id,
            opened_at=comanda.criado_em,
        )

    account = AtendimentoMesa(
        id=f"a-{uuid.uuid4().hex[:12]}",
        restaurante_id=comanda.restaurante_id,
        numero_conta=number,
        periodo_ref=period_ref,
        mesa_id=comanda.mesa_id,
        status="aberto",
        principal_id=(principal.id if principal is not None else None),
        proxima_sequencia=1,
        criado_em=comanda.criado_em or datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(account)
    db.flush()

    if principal is None:
        _record_movement(
            db,
            account,
            "abertura",
            actor_id=actor_id or comanda.garcom_id,
            destination=comanda.mesa_id,
        )
    else:
        inferred_origin = comanda.mesa_origem_id or comanda.mesa_transferida_de
        _record_movement(
            db,
            account,
            "mesclagem",
            actor_id=actor_id or comanda.garcom_id,
            origin=inferred_origin,
            destination=comanda.mesa_id,
            details={
                "principal": principal.id,
                "materializado_de_legado": True,
                "origem_inferida": inferred_origin is not None,
            },
        )
    return account


def ensure_atendimento_for_comanda(
    db: Session,
    comanda: Comanda,
    *,
    actor_id: Optional[str] = None,
) -> AtendimentoMesa:
    if comanda.tipo != "Consumo no Local" or comanda.mesa_id is None:
        raise AtendimentoError("Somente consumo no local possui família de mesa", status_code=400)

    # A mesa é o mutex transacional do ciclo de atendimento. Depois de obter o
    # lock, recarregamos a comanda para enxergar um vínculo confirmado por uma
    # transação concorrente que possa ter esperado pelo mesmo registro.
    lock_table_for_service(db, comanda.restaurante_id, int(comanda.mesa_id))
    locked_command = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == comanda.restaurante_id,
            Comanda.id == comanda.id,
        )
        .with_for_update()
        .first()
    )
    if locked_command is None:
        raise AtendimentoError("Comanda não encontrada", status_code=404)
    comanda = locked_command

    existing = _account_for_comanda(db, comanda.restaurante_id, comanda.id, lock=True)
    if existing is not None:
        _sync_account_status(db, existing)
        return existing

    period_ref = _operational_period(comanda.criado_em)
    legacy_number = int(comanda.numero_pedido or 0)
    same_family = (
        _account_by_number(
            db,
            comanda.restaurante_id,
            period_ref,
            legacy_number,
            lock=True,
        )
        if legacy_number > 0
        else None
    )

    if same_family is not None:
        account = same_family
        # Uma comanda irmã pode ter ficado com mesa antiga no legado. A família
        # é a autoridade sobre localização depois que existe.
        if account.mesa_id is not None and comanda.mesa_id != account.mesa_id:
            comanda.mesa_transferida_de = comanda.mesa_id
            comanda.mesa_id = account.mesa_id
    else:
        principal = reconcile_table_principal(
            db,
            comanda.restaurante_id,
            int(comanda.mesa_id),
            actor_id=actor_id,
        )
        # Número diferente na mesma mesa = família distinta. Isso preserva
        # mesclagens legadas em vez de colapsar #46 e #47 numa única conta.
        account = _new_account(
            db,
            comanda,
            actor_id=actor_id,
            principal=principal,
        )

    db.add(
        AtendimentoComanda(
            restaurante_id=comanda.restaurante_id,
            atendimento_id=account.id,
            comanda_id=comanda.id,
        )
    )
    comanda.numero_pedido = account.numero_conta
    db.flush()
    return account


def get_launch_identity(
    db: Session,
    restaurante_id: int,
    lancamento_id: str,
) -> Optional[PedidoIdentidade]:
    """Consulta a identidade já persistida sem criar ou corrigir estado."""
    row = (
        db.query(LancamentoIdentidade, AtendimentoMesa)
        .join(
            AtendimentoMesa,
            AtendimentoMesa.id == LancamentoIdentidade.atendimento_id,
        )
        .filter(
            LancamentoIdentidade.restaurante_id == restaurante_id,
            LancamentoIdentidade.lancamento_id == lancamento_id,
            AtendimentoMesa.restaurante_id == restaurante_id,
        )
        .first()
    )
    if row is None:
        return None
    identity, account = row
    return PedidoIdentidade(
        atendimento_id=account.id,
        numero_conta=account.numero_conta,
        sequencia=identity.sequencia,
        label=format_order_family_id(account.numero_conta, identity.sequencia),
    )


def _ensure_related_open_comandas_linked(
    db: Session,
    account: AtendimentoMesa,
    seed: Comanda,
) -> None:
    siblings = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == seed.restaurante_id,
            Comanda.mesa_id == account.mesa_id,
            Comanda.fechada == False,
            Comanda.numero_pedido == account.numero_conta,
        )
        .all()
    )
    for sibling in siblings:
        if _account_for_comanda(db, seed.restaurante_id, sibling.id) is None:
            db.add(
                AtendimentoComanda(
                    restaurante_id=seed.restaurante_id,
                    atendimento_id=account.id,
                    comanda_id=sibling.id,
                )
            )
    db.flush()


def ensure_launch_identity(db: Session, lancamento: Lancamento) -> PedidoIdentidade:
    existing = (
        db.query(LancamentoIdentidade)
        .filter(
            LancamentoIdentidade.restaurante_id == lancamento.restaurante_id,
            LancamentoIdentidade.lancamento_id == lancamento.id,
        )
        .first()
    )
    if existing is not None:
        account = db.query(AtendimentoMesa).filter(
            AtendimentoMesa.restaurante_id == lancamento.restaurante_id,
            AtendimentoMesa.id == existing.atendimento_id,
        ).one()
        return PedidoIdentidade(
            atendimento_id=account.id,
            numero_conta=account.numero_conta,
            sequencia=existing.sequencia,
            label=format_order_family_id(account.numero_conta, existing.sequencia),
        )

    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == lancamento.restaurante_id,
        Comanda.id == lancamento.comanda_id,
    ).first()
    if comanda is None:
        raise AtendimentoError("Comanda do lançamento não encontrada", status_code=404)

    account = ensure_atendimento_for_comanda(db, comanda, actor_id=lancamento.garcom_id)
    _ensure_related_open_comandas_linked(db, account, comanda)
    account = db.query(AtendimentoMesa).filter(
        AtendimentoMesa.restaurante_id == lancamento.restaurante_id,
        AtendimentoMesa.id == account.id,
    ).with_for_update().one()

    command_ids = _linked_command_ids(db, account.restaurante_id, account.id)
    launches = (
        db.query(Lancamento)
        .filter(
            Lancamento.restaurante_id == account.restaurante_id,
            Lancamento.comanda_id.in_(command_ids),
        )
        .order_by(Lancamento.timestamp.asc(), Lancamento.id.asc())
        .all()
    )
    identities = {
        identity.lancamento_id: identity
        for identity in db.query(LancamentoIdentidade)
        .filter(
            LancamentoIdentidade.restaurante_id == account.restaurante_id,
            LancamentoIdentidade.atendimento_id == account.id,
        )
        .all()
    }
    used = {identity.sequencia for identity in identities.values()}
    next_sequence = max(int(account.proxima_sequencia or 1), 1)
    for launch in launches:
        if launch.id in identities:
            continue
        while next_sequence in used:
            next_sequence += 1
        identity = LancamentoIdentidade(
            restaurante_id=account.restaurante_id,
            atendimento_id=account.id,
            lancamento_id=launch.id,
            sequencia=next_sequence,
            criado_em=launch.timestamp or datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(identity)
        identities[launch.id] = identity
        used.add(next_sequence)
        next_sequence += 1
    account.proxima_sequencia = next_sequence
    db.flush()

    identity = identities[lancamento.id]
    return PedidoIdentidade(
        atendimento_id=account.id,
        numero_conta=account.numero_conta,
        sequencia=identity.sequencia,
        label=format_order_family_id(account.numero_conta, identity.sequencia),
    )


def get_table_family_snapshot(db: Session, restaurante_id: int, mesa_id: int) -> list[dict]:
    """Projeta famílias já persistidas sem mutar estado derivado.

    Inconsistências e identidades ausentes ficam visíveis no payload em vez de
    serem silenciosamente reparadas por uma leitura HTTP.
    """
    accounts = (
        db.query(AtendimentoMesa)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            AtendimentoMesa.mesa_id == mesa_id,
            AtendimentoMesa.status == "aberto",
        )
        .order_by(AtendimentoMesa.principal_id.asc(), AtendimentoMesa.criado_em.asc())
        .all()
    )
    result: list[dict] = []
    for account in accounts:
        command_ids = _linked_command_ids(db, restaurante_id, account.id)
        launches = (
            db.query(Lancamento)
            .filter(
                Lancamento.restaurante_id == restaurante_id,
                Lancamento.comanda_id.in_(command_ids),
            )
            .order_by(Lancamento.timestamp.asc(), Lancamento.id.asc())
            .all()
            if command_ids
            else []
        )
        launch_rows = []
        for launch in launches:
            identity = get_launch_identity(db, restaurante_id, launch.id)
            launch_rows.append(
                {
                    "lancamento_id": launch.id,
                    "sequencia": identity.sequencia if identity is not None else None,
                    "pedido_id": identity.label if identity is not None else None,
                    "timestamp": launch.timestamp,
                    "identity_status": "persisted" if identity is not None else "missing",
                }
            )
        result.append(
            {
                "atendimento_id": account.id,
                "numero_conta": account.numero_conta,
                "periodo_ref": account.periodo_ref,
                "mesa_id": account.mesa_id,
                "principal": account.principal_id is None,
                "principal_id": account.principal_id,
                "lancamentos": launch_rows,
            }
        )
    return result


def principal_command_for_table(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
) -> Optional[Comanda]:
    root = reconcile_table_principal(db, restaurante_id, mesa_id)
    if root is None:
        return None
    ids = _linked_command_ids(db, restaurante_id, root.id)
    if not ids:
        return None
    commands = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id.in_(ids),
            Comanda.fechada == False,
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
        .all()
    )
    return next((command for command in commands if not (command.identificador or "").strip()), commands[0] if commands else None)


def principal_command_for_comanda(
    db: Session,
    restaurante_id: int,
    comanda_id: str,
    *,
    actor_id: Optional[str] = None,
) -> Optional[Comanda]:
    command = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == comanda_id,
        Comanda.fechada == False,
    ).first()
    if command is None:
        return None
    account = ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
    root = reconcile_table_principal(db, restaurante_id, int(account.mesa_id), actor_id=actor_id)
    if root is None or root.id == account.id:
        return command
    ids = _linked_command_ids(db, restaurante_id, root.id)
    return (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id.in_(ids),
            Comanda.fechada == False,
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
        .first()
    )


def _group_members(db: Session, account: AtendimentoMesa) -> tuple[AtendimentoMesa, list[AtendimentoMesa]]:
    root_id = account.principal_id or account.id
    root = db.query(AtendimentoMesa).filter(
        AtendimentoMesa.restaurante_id == account.restaurante_id,
        AtendimentoMesa.id == root_id,
    ).with_for_update().first()
    if root is None:
        raise AtendimentoError("Família principal não encontrada", status_code=409)
    members = (
        db.query(AtendimentoMesa)
        .filter(
            AtendimentoMesa.restaurante_id == account.restaurante_id,
            AtendimentoMesa.status == "aberto",
            or_(AtendimentoMesa.id == root.id, AtendimentoMesa.principal_id == root.id),
        )
        .with_for_update()
        .all()
    )
    return root, members


def _update_linked_command_tables(
    db: Session,
    account: AtendimentoMesa,
    new_table: int,
    *,
    merge_origin: Optional[int] = None,
    clear_merge: bool = False,
) -> None:
    ids = _linked_command_ids(db, account.restaurante_id, account.id)
    if not ids:
        return
    commands = db.query(Comanda).filter(
        Comanda.restaurante_id == account.restaurante_id,
        Comanda.id.in_(ids),
    ).all()
    for command in commands:
        if command.mesa_id != new_table:
            command.mesa_transferida_de = command.mesa_id
        command.mesa_id = new_table
        if merge_origin is not None:
            command.mesa_origem_id = merge_origin
        elif clear_merge:
            command.mesa_origem_id = None


def transfer_group_by_comanda(
    db: Session,
    restaurante_id: int,
    comanda_id: str,
    nova_mesa_id: int,
    *,
    actor_id: Optional[str] = None,
) -> Comanda:
    command = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == comanda_id,
        Comanda.fechada == False,
    ).first()
    if command is None:
        raise AtendimentoError("Comanda não encontrada", status_code=404)
    if db.query(Mesa.id).filter(
        Mesa.restaurante_id == restaurante_id,
        Mesa.id == nova_mesa_id,
    ).first() is None:
        raise AtendimentoError("Mesa de destino não encontrada", status_code=404)

    account = ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
    root, members = _group_members(db, account)
    member_ids = {member.id for member in members}
    if root.mesa_id == nova_mesa_id:
        return command

    # Reconciliar o destino fecha famílias órfãs antes da decisão estrutural.
    # Sem isso, uma mesa sem comandas visíveis pode responder 409 como ocupada.
    reconcile_table_principal(
        db,
        restaurante_id,
        nova_mesa_id,
        actor_id=actor_id,
    )

    # Sincroniza eventual ocupação legada antes da decisão estrutural.
    occupied = db.query(AtendimentoMesa.id).filter(
        AtendimentoMesa.restaurante_id == restaurante_id,
        AtendimentoMesa.mesa_id == nova_mesa_id,
        AtendimentoMesa.status == "aberto",
        AtendimentoMesa.id.notin_(member_ids),
    ).first()
    if occupied:
        raise AtendimentoError(
            "A mesa de destino está ocupada. Use Mesclar para unir os atendimentos.",
            status_code=409,
        )

    for member in members:
        origin = member.mesa_id
        member.mesa_id = nova_mesa_id
        _update_linked_command_tables(db, member, nova_mesa_id)
        _record_movement(
            db,
            member,
            "transferencia",
            actor_id=actor_id,
            origin=origin,
            destination=nova_mesa_id,
            details={"grupo_principal": root.id},
        )
    db.flush()
    return command


def merge_tables(
    db: Session,
    restaurante_id: int,
    source_table: int,
    target_table: int,
    *,
    actor_id: Optional[str] = None,
) -> AtendimentoMesa:
    if source_table == target_table:
        raise AtendimentoError("Origem e destino devem ser mesas diferentes", status_code=400)
    for mesa_id in (source_table, target_table):
        if db.query(Mesa.id).filter(
            Mesa.restaurante_id == restaurante_id,
            Mesa.id == mesa_id,
        ).first() is None:
            raise AtendimentoError(f"Mesa {mesa_id} não encontrada", status_code=404)

    source_root = reconcile_table_principal(db, restaurante_id, source_table, actor_id=actor_id)
    target_root = reconcile_table_principal(db, restaurante_id, target_table, actor_id=actor_id)
    if source_root is None or target_root is None:
        raise AtendimentoError("As duas mesas precisam possuir atendimento aberto", status_code=409)

    _, source_members = _group_members(db, source_root)
    _, target_members = _group_members(db, target_root)
    if source_root.id == target_root.id:
        return target_root
    if len(source_members) + len(target_members) > 2:
        raise AtendimentoError(
            "A operação excederia o limite atual de duas famílias mescladas.",
            status_code=409,
        )

    for member in source_members:
        origin = member.mesa_id
        member.principal_id = target_root.id
        member.mesa_id = target_table
        _update_linked_command_tables(db, member, target_table, merge_origin=source_table)
        _record_movement(
            db,
            member,
            "mesclagem",
            actor_id=actor_id,
            origin=origin,
            destination=target_table,
            details={"principal": target_root.id},
        )
    db.flush()
    return target_root


def unmerge_by_comanda(
    db: Session,
    restaurante_id: int,
    comanda_id: str,
    *,
    actor_id: Optional[str] = None,
) -> Comanda:
    command = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == comanda_id,
    ).first()
    if command is None:
        raise AtendimentoError("Comanda não encontrada", status_code=404)
    account = ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
    account = db.query(AtendimentoMesa).filter(
        AtendimentoMesa.restaurante_id == restaurante_id,
        AtendimentoMesa.id == account.id,
    ).with_for_update().one()
    if account.principal_id is None:
        raise AtendimentoError("Esta família não está mesclada", status_code=409)

    last_merge = (
        db.query(MovimentoAtendimento)
        .filter(
            MovimentoAtendimento.restaurante_id == restaurante_id,
            MovimentoAtendimento.atendimento_id == account.id,
            MovimentoAtendimento.tipo == "mesclagem",
        )
        .order_by(MovimentoAtendimento.criado_em.desc(), MovimentoAtendimento.id.desc())
        .first()
    )
    origin = last_merge.mesa_origem_id if last_merge else None
    if origin is None:
        raise AtendimentoError("Origem da mesclagem não pôde ser reconstruída", status_code=409)
    occupied = db.query(AtendimentoMesa.id).filter(
        AtendimentoMesa.restaurante_id == restaurante_id,
        AtendimentoMesa.mesa_id == origin,
        AtendimentoMesa.status == "aberto",
        AtendimentoMesa.id != account.id,
    ).first()
    if occupied:
        raise AtendimentoError(
            "A mesa de origem já foi reutilizada; escolha uma transferência explícita.",
            status_code=409,
        )

    previous = account.mesa_id
    account.principal_id = None
    account.mesa_id = origin
    _update_linked_command_tables(db, account, origin, clear_merge=True)
    _record_movement(
        db,
        account,
        "desmesclagem",
        actor_id=actor_id,
        origin=previous,
        destination=origin,
    )
    db.flush()
    return command


def _account_active_item_count(db: Session, account: AtendimentoMesa) -> int:
    ids = _linked_command_ids(db, account.restaurante_id, account.id)
    if not ids:
        return 0
    return int(
        db.query(func.count(Item.id))
        .filter(
            Item.restaurante_id == account.restaurante_id,
            Item.comanda_id.in_(ids),
            Item.status != "cancelado",
        )
        .scalar()
        or 0
    )


def _new_destination_account_and_command(
    db: Session,
    source_command: Comanda,
    target_table: int,
) -> tuple[AtendimentoMesa, Comanda]:
    number, period = allocate_account_number(db, source_command.restaurante_id)
    account = AtendimentoMesa(
        id=f"a-{uuid.uuid4().hex[:12]}",
        restaurante_id=source_command.restaurante_id,
        numero_conta=number,
        periodo_ref=period,
        mesa_id=target_table,
        status="aberto",
        principal_id=None,
        proxima_sequencia=1,
    )
    command = Comanda(
        id=f"c-{uuid.uuid4().hex[:8]}",
        restaurante_id=source_command.restaurante_id,
        mesa_id=target_table,
        garcom_id=source_command.garcom_id,
        tipo="Consumo no Local",
        identificador=source_command.identificador,
        numero_pedido=number,
        fechada=False,
        criado_em=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add_all([account, command])
    db.flush()
    db.add(
        AtendimentoComanda(
            restaurante_id=source_command.restaurante_id,
            atendimento_id=account.id,
            comanda_id=command.id,
        )
    )
    _record_movement(
        db,
        account,
        "abertura",
        actor_id=source_command.garcom_id,
        destination=target_table,
    )
    return account, command


def transfer_items_batch(
    db: Session,
    restaurante_id: int,
    item_ids: Iterable[str],
    target_table: int,
    *,
    actor_id: Optional[str] = None,
) -> list[Item]:
    normalized = list(dict.fromkeys(str(item_id) for item_id in item_ids if item_id))
    if not normalized:
        raise AtendimentoError("Selecione ao menos um item", status_code=422)
    if db.query(Mesa.id).filter(
        Mesa.restaurante_id == restaurante_id,
        Mesa.id == target_table,
    ).first() is None:
        raise AtendimentoError("Mesa de destino não encontrada", status_code=404)

    items = (
        db.query(Item)
        .options(joinedload(Item.comanda))
        .filter(Item.restaurante_id == restaurante_id, Item.id.in_(normalized))
        .with_for_update()
        .all()
    )
    if len(items) != len(normalized):
        raise AtendimentoError("Um ou mais itens não foram encontrados", status_code=404)
    if any(item.status == "cancelado" for item in items):
        raise AtendimentoError("Itens cancelados não podem ser transferidos", status_code=409)
    if any(item.comanda is None for item in items):
        raise AtendimentoError("Há item sem comanda válida", status_code=409)

    source_commands = {item.comanda_id: item.comanda for item in items}
    source_accounts = {
        command_id: ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
        for command_id, command in source_commands.items()
    }
    if any(account.mesa_id == target_table for account in source_accounts.values()):
        raise AtendimentoError("O item já pertence à mesa de destino", status_code=409)

    destination_account = reconcile_table_principal(db, restaurante_id, target_table, actor_id=actor_id)
    if destination_account is None:
        destination_account, destination_command = _new_destination_account_and_command(
            db,
            next(iter(source_commands.values())),
            target_table,
        )
    else:
        destination_ids = _linked_command_ids(db, restaurante_id, destination_account.id)
        destination_command = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.id.in_(destination_ids),
                Comanda.fechada == False,
            )
            .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
            .first()
        )
        if destination_command is None:
            raise AtendimentoError("Família destino sem comanda aberta", status_code=409)

    origin_by_item = {item.id: item.comanda.mesa_id for item in items}
    for item in items:
        source_account = source_accounts[item.comanda_id]
        launch = db.query(Lancamento).filter(
            Lancamento.restaurante_id == restaurante_id,
            Lancamento.id == item.lancamento_id,
        ).first()
        original_order = ensure_launch_identity(db, launch).label if launch is not None else None
        old_command_id = item.comanda_id
        # Atualiza FK e relacionamento no mesmo instante; evita objeto ORM stale
        # após uma transferência parcial dentro da mesma transação.
        item.comanda_id = destination_command.id
        item.comanda = destination_command
        _record_movement(
            db,
            source_account,
            "transferencia_item",
            actor_id=actor_id,
            origin=origin_by_item[item.id],
            destination=target_table,
            details={
                "item_id": item.id,
                "comanda_origem": old_command_id,
                "comanda_destino": destination_command.id,
                "atendimento_destino": destination_account.id,
                "pedido_origem": original_order,
            },
        )

    db.flush()
    unique_sources = {account.id: account for account in source_accounts.values()}.values()
    for source_account in unique_sources:
        if _account_active_item_count(db, source_account) == 0:
            source_account.status = "fechado"
            source_account.fechado_em = datetime.datetime.now(datetime.timezone.utc)
            for command_id in _linked_command_ids(db, restaurante_id, source_account.id):
                command = db.query(Comanda).filter(
                    Comanda.restaurante_id == restaurante_id,
                    Comanda.id == command_id,
                ).first()
                if command is not None:
                    command.fechada = True
                    command.fechado_em = source_account.fechado_em
            _record_movement(
                db,
                source_account,
                "fechamento",
                actor_id=actor_id,
                origin=source_account.mesa_id,
                details={"motivo": "familia_esvaziada_por_transferencia"},
            )
    reconcile_table_principal(db, restaurante_id, target_table, actor_id=actor_id)
    db.flush()
    return items


def reopen_command_guarded(
    db: Session,
    restaurante_id: int,
    comanda_id: str,
    *,
    actor_id: Optional[str] = None,
) -> Comanda:
    command = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == comanda_id,
    ).with_for_update().first()
    if command is None:
        raise AtendimentoError("Comanda não encontrada", status_code=404)
    if not command.fechada:
        return command

    account = _account_for_comanda(db, restaurante_id, command.id, lock=True)
    if account is None:
        if command.mesa_id is not None:
            occupied = reconcile_table_principal(db, restaurante_id, command.mesa_id, actor_id=actor_id)
            if occupied is not None:
                raise AtendimentoError(
                    "A mesa original já está ocupada. Reabra escolhendo uma nova mesa ou mesclagem explícita.",
                    status_code=409,
                )
        command.fechada = False
        command.fechado_em = None
        account = ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
    else:
        target = account.mesa_id
        if target is not None:
            root = reconcile_table_principal(db, restaurante_id, target, actor_id=actor_id)
            if root is not None and root.id not in {account.id, account.principal_id}:
                raise AtendimentoError(
                    "A mesa original já foi reutilizada. Escolha explicitamente onde reabrir esta conta.",
                    status_code=409,
                )
        command.fechada = False
        command.fechado_em = None
        account.status = "aberto"
        account.fechado_em = None

    _record_movement(
        db,
        account,
        "reabertura",
        actor_id=actor_id,
        destination=account.mesa_id,
    )
    db.flush()
    return command
