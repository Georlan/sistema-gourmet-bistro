"""Regras compartilhadas para identificar clientes por telefone."""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import event, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    Cliente,
    Comanda,
    ConfigFidelizacao,
    HistoricoFidelidade,
    Pagamento,
)
from .plan_entitlements import ENTITLEMENT_LOYALTY, has_plan_entitlement


CENTAVOS = Decimal("0.01")
logger = logging.getLogger("koma.clientes")
_ONLINE_LOYALTY_PENDING_KEY = "koma_online_loyalty_pending"


def normalizar_telefone_cliente(telefone: str) -> str:
    """Retorna apenas DDD+número e rejeita identificadores ambíguos."""
    normalizado = "".join(caractere for caractere in (telefone or "") if caractere.isdigit())
    if len(normalizado) not in {10, 11}:
        raise ValueError("Telefone do cliente deve conter DDD e 10 ou 11 dígitos.")
    return normalizado


def normalizar_nome_cliente(nome: str) -> str:
    normalizado = " ".join((nome or "").strip().split())
    if len(normalizado) < 2:
        raise ValueError("Nome do cliente deve conter pelo menos 2 caracteres.")
    if len(normalizado) > 100:
        raise ValueError("Nome do cliente deve conter no máximo 100 caracteres.")
    return normalizado


def buscar_cliente_por_telefone(
    db: Session,
    *,
    restaurante_id: int,
    telefone: str,
    bloquear: bool = False,
) -> Optional[Cliente]:
    telefone_normalizado = normalizar_telefone_cliente(telefone)
    query = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.telefone == telefone_normalizado,
    )
    if bloquear:
        query = query.with_for_update()
    return query.first()


def buscar_cliente_por_id(
    db: Session,
    *,
    restaurante_id: int,
    cliente_id: str,
    bloquear: bool = False,
) -> Optional[Cliente]:
    query = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.id == cliente_id,
    )
    if bloquear:
        query = query.with_for_update()
    return query.first()


def cadastrar_ou_atualizar_cliente(
    db: Session,
    *,
    restaurante_id: int,
    telefone: str,
    nome: str,
    endereco: Optional[str] = None,
) -> Cliente:
    """Cria ou atualiza uma única ficha por restaurante e telefone.

    A restrição única no banco continua sendo a última linha de defesa. O
    savepoint permite recuperar de duas primeiras compras simultâneas sem
    desfazer o restante da transação do pedido.
    """
    telefone_normalizado = normalizar_telefone_cliente(telefone)
    nome_normalizado = normalizar_nome_cliente(nome)
    endereco_normalizado = (endereco or "").strip() or None

    cliente = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.telefone == telefone_normalizado,
    ).first()

    if cliente is None:
        novo_cliente = Cliente(
            id=str(uuid.uuid4()),
            restaurante_id=restaurante_id,
            telefone=telefone_normalizado,
            nome=nome_normalizado,
            endereco=endereco_normalizado,
            saldo_pontos=0,
            saldo_cashback=0.0,
        )
        try:
            with db.begin_nested():
                db.add(novo_cliente)
                db.flush([novo_cliente])
            cliente = novo_cliente
        except IntegrityError:
            cliente = db.query(Cliente).filter(
                Cliente.restaurante_id == restaurante_id,
                Cliente.telefone == telefone_normalizado,
            ).one()

    cliente.nome = nome_normalizado
    if endereco_normalizado is not None:
        cliente.endereco = endereco_normalizado
    db.flush([cliente])
    return cliente


def registrar_movimento_fidelidade(
    db: Session,
    *,
    cliente: Cliente,
    tipo_movimentacao: str,
    valor_delta: Decimal | float | int,
    tipo_recompensa: str,
    comanda_id: Optional[str] = None,
    flush: bool = True,
) -> HistoricoFidelidade:
    """Registra o ledger e o saldo materializado na mesma transação.

    ``cliente_id`` é a fonte de identidade. O telefone criptografado continua
    como snapshot de compatibilidade, nunca como chave de relacionamento.
    """
    movimento = tipo_movimentacao.strip().upper()
    recompensa = tipo_recompensa.strip().upper()
    if movimento not in {"ACUMULO", "RESGATE"}:
        raise ValueError("Movimentação de fidelidade inválida.")
    if recompensa not in {"PONTOS", "CASHBACK"}:
        raise ValueError("Tipo de recompensa inválido.")

    delta = Decimal(str(valor_delta))
    if delta <= 0:
        raise ValueError("O valor da movimentação deve ser positivo.")
    sinal = Decimal("1") if movimento == "ACUMULO" else Decimal("-1")

    if recompensa == "PONTOS":
        pontos_delta = int(delta.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if pontos_delta <= 0:
            raise ValueError("A movimentação deve alterar ao menos um ponto.")
        novo_saldo = int(cliente.saldo_pontos or 0) + (
            pontos_delta if movimento == "ACUMULO" else -pontos_delta
        )
        if novo_saldo < 0:
            raise ValueError("Saldo de pontos insuficiente.")
        cliente.saldo_pontos = novo_saldo
        valor_ledger = Decimal(pontos_delta)
    else:
        cashback_delta = delta.quantize(CENTAVOS, rounding=ROUND_HALF_UP)
        novo_saldo = Decimal(str(cliente.saldo_cashback or 0)) + (
            cashback_delta * sinal
        )
        if novo_saldo < 0:
            raise ValueError("Saldo de cashback insuficiente.")
        cliente.saldo_cashback = novo_saldo.quantize(
            CENTAVOS,
            rounding=ROUND_HALF_UP,
        )
        valor_ledger = cashback_delta

    registro = HistoricoFidelidade(
        restaurante_id=cliente.restaurante_id,
        cliente_id=cliente.id,
        cliente_telefone=cliente.telefone,
        tipo_movimentacao=movimento,
        valor_delta=valor_ledger,
        comanda_id=comanda_id,
    )
    db.add(registro)
    if flush:
        db.flush([cliente, registro])
    return registro


def registrar_fidelidade_compra_quitada(
    db: Session,
    *,
    comanda: Comanda,
    cliente: Optional[Cliente] = None,
    valor_base: Decimal | float | int | None = None,
    flush: bool = True,
) -> bool:
    """Credita fidelidade uma única vez para uma venda válida e identificada.

    O crédito é tenant-scoped e idempotente por ``comanda_id``. Pedidos
    recusados/cancelados e pagamentos sem cliente nunca geram benefício.
    """
    if not has_plan_entitlement(
        db,
        comanda.restaurante_id,
        ENTITLEMENT_LOYALTY,
    ):
        return False
    if (comanda.delivery_status or "").strip().lower() == "recusado":
        return False
    if (comanda.online_payment_status or "").strip().lower() in {
        "rejected",
        "cancelled",
        "expired",
    }:
        return False

    if cliente is None and comanda.cliente_id:
        cliente = buscar_cliente_por_id(
            db,
            restaurante_id=comanda.restaurante_id,
            cliente_id=comanda.cliente_id,
            bloquear=True,
        )
    if cliente is None:
        return False

    ja_registrado = db.query(HistoricoFidelidade).filter(
        HistoricoFidelidade.restaurante_id == comanda.restaurante_id,
        HistoricoFidelidade.comanda_id == comanda.id,
        HistoricoFidelidade.tipo_movimentacao == "ACUMULO",
    ).first()
    if ja_registrado is not None:
        return False

    # Também protege o caso em que o ledger foi adicionado à sessão mas ainda
    # não passou pelo próximo flush (ex.: aprovação Pix dentro de after_flush).
    for pending in db.new:
        if (
            isinstance(pending, HistoricoFidelidade)
            and pending.restaurante_id == comanda.restaurante_id
            and pending.comanda_id == comanda.id
            and pending.tipo_movimentacao == "ACUMULO"
        ):
            return False

    fidel_config = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == comanda.restaurante_id,
    ).first()
    if not fidel_config or not fidel_config.ativo:
        return False

    total_pago = Decimal(str(
        valor_base if valor_base is not None else (comanda.valor_pago or 0)
    )).quantize(CENTAVOS, rounding=ROUND_HALF_UP)
    if total_pago <= Decimal("0.00"):
        return False

    taxa = Decimal(str(fidel_config.taxa_conversao or 0))
    recompensa = (fidel_config.tipo_recompensa or "").strip().upper()
    if recompensa == "PONTOS":
        delta_val = total_pago * taxa
        if delta_val < Decimal("0.5"):
            return False
    elif recompensa == "CASHBACK":
        delta_val = (total_pago * taxa / Decimal("100")).quantize(
            CENTAVOS,
            rounding=ROUND_HALF_UP,
        )
        if delta_val <= Decimal("0.00"):
            return False
    else:
        return False

    registrar_movimento_fidelidade(
        db,
        cliente=cliente,
        tipo_movimentacao="ACUMULO",
        valor_delta=delta_val,
        tipo_recompensa=recompensa,
        comanda_id=comanda.id,
        flush=flush,
    )
    return True


def _insert_guest_cliente_if_needed(
    connection,
    comanda: Comanda,
) -> tuple[Optional[str], Optional[str]]:
    """Materializa a identidade comercial de um pedido antes do INSERT.

    Retorna ``(cliente_id, nome_canônico)``. Conhecer o telefone não concede
    acesso à conta do cliente. Para pedidos públicos sem autenticação, uma ficha
    existente é apenas vinculada e nunca tem nome/endereço sobrescritos. Se o
    telefone ainda não existir, nasce uma ficha guest mínima. A operação usa
    upsert por tenant+telefone para suportar duas primeiras compras concorrentes
    sem duplicar o cliente.
    """
    if comanda.cliente_id:
        clientes = Cliente.__table__
        existing = connection.execute(
            select(clientes.c.id, clientes.c.nome).where(
                (clientes.c.restaurante_id == comanda.restaurante_id)
                & (clientes.c.id == comanda.cliente_id)
            )
        ).first()
        if existing is not None:
            return str(existing.id), str(existing.nome)
        return str(comanda.cliente_id), None

    raw_phone = comanda.delivery_telefone
    raw_name = comanda.identificador
    if not raw_phone or not raw_name:
        return None, None
    try:
        telefone = normalizar_telefone_cliente(raw_phone)
        nome = normalizar_nome_cliente(raw_name)
    except ValueError:
        return None, None

    clientes = Cliente.__table__
    criteria = (
        (clientes.c.restaurante_id == comanda.restaurante_id)
        & (clientes.c.telefone == telefone)
    )
    existing = connection.execute(
        select(clientes.c.id, clientes.c.nome).where(criteria)
    ).first()
    if existing is not None:
        return str(existing.id), str(existing.nome)

    cliente_id = str(uuid.uuid4())
    values = {
        "id": cliente_id,
        "restaurante_id": comanda.restaurante_id,
        "telefone": telefone,
        "nome": nome,
        "endereco": (comanda.delivery_endereco or "").strip() or None,
        "saldo_pontos": 0,
        "saldo_cashback": 0.0,
    }

    dialect = connection.dialect.name
    if dialect == "postgresql":
        statement = pg_insert(clientes).values(**values).on_conflict_do_nothing(
            index_elements=["restaurante_id", "telefone"],
        )
        connection.execute(statement)
    elif dialect == "sqlite":
        statement = sqlite_insert(clientes).values(**values).on_conflict_do_nothing(
            index_elements=["restaurante_id", "telefone"],
        )
        connection.execute(statement)
    else:
        try:
            connection.execute(clientes.insert().values(**values))
        except IntegrityError:
            # Em dialetos sem UPSERT explícito, a constraint composta ainda é a
            # última defesa. O SELECT seguinte recupera o vencedor da corrida.
            logger.info(
                "Concorrência ao criar cliente guest para tenant %s.",
                comanda.restaurante_id,
            )

    resolved = connection.execute(
        select(clientes.c.id, clientes.c.nome).where(criteria)
    ).first()
    if resolved is None:
        return None, None
    return str(resolved.id), str(resolved.nome)


@event.listens_for(Comanda, "before_insert")
def _vincular_cliente_universal_antes_da_comanda(_mapper, connection, target: Comanda) -> None:
    """Garante identidade canônica para qualquer canal que informe telefone."""
    resolved_id, canonical_name = _insert_guest_cliente_if_needed(connection, target)
    if resolved_id is not None:
        target.cliente_id = resolved_id
    if canonical_name:
        target.identificador = canonical_name


@event.listens_for(Session, "before_flush")
def _rastrear_pagamentos_online_para_fidelidade(session, _flush_context, _instances) -> None:
    pending = session.info.setdefault(_ONLINE_LOYALTY_PENDING_KEY, set())
    for obj in session.new:
        if not isinstance(obj, Pagamento):
            continue
        if obj.status != "aprovado" or not obj.cliente_id:
            continue
        idempotency_key = (obj.idempotency_key or "").strip()
        if not idempotency_key.startswith("online:mercado_pago:"):
            continue
        pending.add((int(obj.restaurante_id), str(obj.id)))


@event.listens_for(Session, "after_flush_postexec")
def _creditar_fidelidade_pagamento_online(session, _flush_context) -> None:
    pending = session.info.pop(_ONLINE_LOYALTY_PENDING_KEY, set())
    if not pending:
        return

    for restaurante_id, pagamento_id in pending:
        pagamento = session.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.id == pagamento_id,
            Pagamento.status == "aprovado",
        ).first()
        if pagamento is None or not pagamento.cliente_id:
            continue

        comanda = session.query(Comanda).filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id == pagamento.comanda_id,
        ).with_for_update().first()
        if comanda is None:
            continue

        cliente = buscar_cliente_por_id(
            session,
            restaurante_id=restaurante_id,
            cliente_id=pagamento.cliente_id,
            bloquear=True,
        )
        if cliente is None:
            continue

        registrar_fidelidade_compra_quitada(
            session,
            comanda=comanda,
            cliente=cliente,
            valor_base=pagamento.valor,
            flush=False,
        )


def cliente_payload(cliente: Cliente) -> dict:
    return {
        "id": cliente.id,
        "cliente": cliente.nome,
        "nome": cliente.nome,
        "telefone": cliente.telefone,
        "endereco": cliente.endereco or "",
        "pontos": int(cliente.saldo_pontos or 0),
        "saldo_pontos": int(cliente.saldo_pontos or 0),
        "saldoCashback": float(cliente.saldo_cashback or 0),
        "saldo_cashback": float(cliente.saldo_cashback or 0),
    }