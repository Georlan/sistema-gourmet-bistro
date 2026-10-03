"""Read-only enrichment of check DTOs with persisted order identities and modifiers.

Batch lookup includes launches referenced by transferred items, not only the
launches originally created in this check. Missing identity remains null.
"""

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..domain.orders.types import format_order_family_id
from ..models import Comanda, Lancamento, Usuario
from ..operational_models import AtendimentoMesa, LancamentoIdentidade
from ..schemas import ComandaDetail, ItemModifierResponse


def _attach_item_modifiers(
    db: Session,
    details: list[ComandaDetail],
    restaurante_id: int,
) -> None:
    item_ids = [
        str(item.id)
        for detail in details
        for item in detail.itens
        if item.id
    ]
    if not item_ids:
        return

    from .order_item_composition import load_item_modifiers, uses_grouped_composition

    modifiers_by_item = load_item_modifiers(db, restaurante_id, item_ids)
    grouped = uses_grouped_composition(db, restaurante_id)
    for detail in details:
        for item in detail.itens:
            item.modificadores = [ItemModifierResponse(
                id=modifier.id, nome=modifier.nome, preco=modifier.preco,
                grupo_id=modifier.grupo_id, grupo_nome=modifier.grupo_nome,
            ) for modifier in modifiers_by_item.get(str(item.id), [])]
            item.composicao_agrupada = grouped


def project_check_details(
    db: Session, checks: list[Comanda], restaurante_id: int,
) -> list[ComandaDetail]:
    details = [ComandaDetail.model_validate(check) for check in checks]
    _attach_item_modifiers(db, details, restaurante_id)

    launch_ids = {
        launch.id for detail in details for launch in detail.lancamentos
    } | {
        item.lancamento_id for detail in details for item in detail.itens
        if item.lancamento_id
    }
    if not launch_ids:
        return details
    launch_context = {
        row.id: row for row in db.query(
            Lancamento.id, Lancamento.timestamp, Lancamento.origem,
            Usuario.nome.label("responsavel_nome"),
        ).outerjoin(Usuario, and_(
            Usuario.id == Lancamento.garcom_id,
            Usuario.restaurante_id == Lancamento.restaurante_id,
        )).filter(
            Lancamento.restaurante_id == restaurante_id,
            Lancamento.id.in_(launch_ids),
        ).all()
    }
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
            context = launch_context.get(item.lancamento_id)
            if context:
                item.lancamento_timestamp = context.timestamp
                item.lancamento_origem = context.origem
                item.lancamento_responsavel_nome = context.responsavel_nome
    return details
