from __future__ import annotations

import datetime

from sqlalchemy.orm import Session, joinedload

from ...domain.printing.routing import is_production_destination
from ...models import Item, PrintJob, Produto
from ...services.printing import enqueue_print_job
from .intent import PrintAction, PrintIntent, PrintSourceType
from .service import UniversalPrintingError


class ItemChangePrintingService:
    """Renderiza a via delta de edição/adição a partir do snapshot persistido.

    A borda informa apenas qual item mudou e quantas unidades foram adicionadas.
    Produto, mesa, cliente, observação e destino são reconstruídos do banco para
    que a rota não volte a montar texto térmico nem escolher impressora.
    """

    @classmethod
    def request_print(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
        if intent.source_type != PrintSourceType.ITEM:
            raise UniversalPrintingError(
                "Origem inválida para impressão de alteração de item",
                status_code=422,
            )
        if intent.action != PrintAction.ITEM_CHANGE:
            raise UniversalPrintingError(
                "Item aceita somente a ação de impressão de alteração",
                status_code=422,
            )
        if (
            not isinstance(intent.quantity_added, int)
            or isinstance(intent.quantity_added, bool)
            or intent.quantity_added < 0
        ):
            raise UniversalPrintingError(
                "Quantidade adicionada inválida para impressão",
                status_code=422,
            )

        item = (
            db.query(Item)
            .options(
                joinedload(Item.produto).joinedload(Produto.categoria),
                joinedload(Item.comanda),
            )
            .filter(
                Item.restaurante_id == intent.restaurant_id,
                Item.id == str(intent.source_id or "").strip(),
            )
            .first()
        )
        if item is None:
            raise UniversalPrintingError("Item não encontrado", status_code=404)
        if item.produto is None:
            raise UniversalPrintingError(
                "Produto do item não encontrado",
                status_code=409,
            )
        if item.comanda is None or item.comanda.restaurante_id != intent.restaurant_id:
            raise UniversalPrintingError(
                "Comanda do item não encontrada",
                status_code=404,
            )

        categoria = item.produto.categoria
        destination = (
            categoria.destino_impressao
            if categoria is not None and categoria.destino_impressao
            else "COZINHA"
        )
        destination = str(destination or "COZINHA").strip().upper()
        if not is_production_destination(destination):
            return []

        payload = cls._render_item_change(item, quantity_added=intent.quantity_added)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
        idempotency_key = (
            f"{intent.idempotency_key}:{destination.lower()}"
            if intent.idempotency_key
            else f"universal:item-change:{item.id}:{destination.lower()}:{stamp}"
        )
        job = enqueue_print_job(
            db,
            restaurante_id=intent.restaurant_id,
            document_type="producao",
            destination=destination,
            source_type=PrintSourceType.ITEM.value,
            source_id=item.id,
            payload_text=payload,
            idempotency_key=idempotency_key,
        )
        return [job] if job is not None else []

    @staticmethod
    def _render_item_change(item: Item, *, quantity_added: int) -> str:
        comanda = item.comanda
        mesa_label = comanda.mesa_id if comanda and comanda.mesa_id else "BALCAO"
        header = "=== ITEM ALTERADO/ADICIONADO ==="
        lines = [
            header.center(32),
            f"MESA: {mesa_label}",
            f"PRODUTO: {item.produto.nome}",
            f"OBS (EDITADO): {item.observacao or ''}",
            f"CLIENTE: {item.cliente_nome or ''}",
        ]
        if quantity_added > 0:
            lines.append(f"QTD ADICIONADA: +{quantity_added}")
        lines.append("=" * 32)
        return "\n".join(lines) + "\n\n\n"
