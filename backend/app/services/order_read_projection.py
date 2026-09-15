"""Read-only enrichment of check DTOs with persisted order identities and modifiers.

Batch lookup includes launches referenced by transferred items, not only the
launches originally created in this check. Missing identity remains null.
"""
from collections import defaultdict

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..domain.orders.types import format_order_family_id
from ..models import Comanda, ItemModificador, OpcaoModificador
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

    rows = (
        db.query(ItemModificador, OpcaoModificador)
        .join(
            OpcaoModificador,
            and_(
                OpcaoModificador.restaurante_id == ItemModificador.restaurante_id,
                OpcaoModificador.id == ItemModificador.opcao_modificador_id,
            ),
        )
        .filter(
            ItemModificador.restaurante_id == restaurante_id,
            ItemModificador.item_id.in_(item_ids),
        )
        .order_by(ItemModificador.item_id.asc(), ItemModificador.id.asc())
        .all()
    )

    modifiers_by_item: dict[str, list[ItemModifierResponse]] = defaultdict(list)
    for item_modifier, option in rows:
        modifiers_by_item[str(item_modifier.item_id)].append(
            ItemModifierResponse(
                id=str(option.id),
                nome=option.nome,
                preco=float(item_modifier.preco_aplicado or 0.0),
            )
        )

    for detail in details:
        for item in detail.itens:
            item.modificadores = modifiers_by_item.get(str(item.id), [])


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
