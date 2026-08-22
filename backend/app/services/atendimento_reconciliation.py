from __future__ import annotations

import datetime
from dataclasses import asdict, dataclass
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Comanda
from ..operational_models import AtendimentoComanda, AtendimentoMesa, MovimentoAtendimento


@dataclass(frozen=True)
class InconsistentAtendimento:
    restaurante_id: int
    atendimento_id: str
    mesa_id: Optional[int]
    numero_conta: int
    periodo_ref: str
    linked_commands: int
    open_commands: int

    def to_dict(self) -> dict:
        return asdict(self)


def find_open_atendimentos_without_open_commands(
    db: Session,
    *,
    restaurante_id: Optional[int] = None,
    lock: bool = False,
) -> list[InconsistentAtendimento]:
    """Lista estado derivado aberto que não possui nenhuma comanda aberta."""
    query = db.query(AtendimentoMesa).filter(AtendimentoMesa.status == "aberto")
    if restaurante_id is not None:
        query = query.filter(AtendimentoMesa.restaurante_id == restaurante_id)
    if lock:
        query = query.with_for_update()

    findings: list[InconsistentAtendimento] = []
    for account in query.order_by(
        AtendimentoMesa.restaurante_id.asc(),
        AtendimentoMesa.criado_em.asc(),
        AtendimentoMesa.id.asc(),
    ).all():
        linked_ids = [
            row[0]
            for row in db.query(AtendimentoComanda.comanda_id)
            .filter(
                AtendimentoComanda.restaurante_id == account.restaurante_id,
                AtendimentoComanda.atendimento_id == account.id,
            )
            .all()
        ]
        open_count = 0
        if linked_ids:
            open_count = (
                db.query(Comanda.id)
                .filter(
                    Comanda.restaurante_id == account.restaurante_id,
                    Comanda.id.in_(linked_ids),
                    Comanda.fechada == False,
                )
                .count()
            )
        if open_count == 0:
            findings.append(
                InconsistentAtendimento(
                    restaurante_id=account.restaurante_id,
                    atendimento_id=account.id,
                    mesa_id=account.mesa_id,
                    numero_conta=account.numero_conta,
                    periodo_ref=account.periodo_ref,
                    linked_commands=len(linked_ids),
                    open_commands=0,
                )
            )
    return findings


def repair_open_atendimentos_without_open_commands(
    db: Session,
    *,
    restaurante_id: int,
    expected_count: int,
    actor_id: Optional[str] = None,
    repaired_at: Optional[datetime.datetime] = None,
) -> list[InconsistentAtendimento]:
    """Fecha inconsistências sob lock e registra cada correção no ledger.

    ``expected_count`` torna a execução fail-closed: se o diagnóstico mudou
    entre o dry-run e a aplicação, nada é alterado e o operador precisa auditar
    novamente.
    """
    if restaurante_id <= 0:
        raise ValueError("restaurante_id positivo é obrigatório para reparar")
    if expected_count < 0:
        raise ValueError("expected_count não pode ser negativo")

    findings = find_open_atendimentos_without_open_commands(
        db,
        restaurante_id=restaurante_id,
        lock=True,
    )
    if len(findings) != expected_count:
        raise RuntimeError(
            "Quantidade de inconsistências mudou: "
            f"esperado={expected_count}, atual={len(findings)}. "
            "Execute um novo dry-run antes de aplicar."
        )

    timestamp = repaired_at or datetime.datetime.now(datetime.timezone.utc)
    accounts = {
        account.id: account
        for account in db.query(AtendimentoMesa)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            AtendimentoMesa.id.in_([finding.atendimento_id for finding in findings]),
        )
        .with_for_update()
        .all()
    }
    for finding in findings:
        account = accounts[finding.atendimento_id]
        account.status = "fechado"
        account.fechado_em = timestamp
        db.add(
            MovimentoAtendimento(
                restaurante_id=restaurante_id,
                atendimento_id=account.id,
                tipo="fechamento",
                mesa_origem_id=account.mesa_id,
                mesa_destino_id=account.mesa_id,
                ator_id=actor_id,
                detalhes={
                    "motivo": "reparacao_estado_derivado_sem_comanda_aberta",
                    "procedimento": "h3o.1",
                    "linked_commands": finding.linked_commands,
                    "open_commands": finding.open_commands,
                },
                criado_em=timestamp,
            )
        )
    db.flush()
    return findings
