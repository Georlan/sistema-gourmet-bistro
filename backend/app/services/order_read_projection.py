"""Read-only enrichment of check DTOs with persisted order identities.

Batch lookup includes launches referenced by transferred items, not only the
launches originally created in this check. Missing identity remains null.
"""
from sqlalchemy.orm import Session

from ..domain.orders.types import format_order_family_id
from ..models import Comanda
from ..operational_models import AtendimentoMesa, LancamentoIdentidade
from ..schemas import ComandaDetail


def project_check_details(
    db: Session, checks: list[Comanda], restaurante_id: int,
) -> list[ComandaDetail]:
    details = [ComandaDetail.model_validate(check) for check in checks]
    launch_ids = {
        launch.id for detail in details for launch in detail.lancamentos
    } | {
        item.lancamento_id for detail in details for item in detail.itens
        if item.lancamento_id
    }
    if not launch_ids:
        return details
    rows = (
        db.query(LancamentoIdentidade.lancamento_id,
                 LancamentoIdentidade.sequencia, AtendimentoMesa.numero_conta)
        .join(AtendimentoMesa, AtendimentoMesa.id == LancamentoIdentidade.atendimento_id)
        .filter(
            LancamentoIdentidade.restaurante_id == restaurante_id,
            AtendimentoMesa.restaurante_id == restaurante_id,
            LancamentoIdentidade.lancamento_id.in_(launch_ids),
        )
        .all()
    )
    labels = {
        launch_id: format_order_family_id(check_number, sequence)
        for launch_id, sequence, check_number in rows
    }
    for detail in details:
        for launch in detail.lancamentos:
            launch.display_number = labels.get(launch.id)
        for item in detail.itens:
            item.lancamento_display_number = labels.get(item.lancamento_id)
    return details
