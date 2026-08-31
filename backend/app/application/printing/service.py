from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from ...domain.printing import OrderPrintData, PrintDocumentService, PrintItem
from ...models import Comanda, Item, Lancamento, PrintJob
from ...services.printing import (
    PrintingRequestError,
    enqueue_cash_closing_receipt,
    enqueue_print_job,
    enqueue_table_receipt,
    get_print_preferences,
)
from ...timezone_utils import to_operational_local_time
from .intent import PrintAction, PrintIntent, PrintSourceType


class UniversalPrintingError(PrintingRequestError):
    """Erro do Core Universal de Impressão traduzível na borda HTTP."""


class PrintingApplicationService:
    """Único orquestrador de intenção -> política -> documento -> PrintJob.

    Nesta primeira etapa, formatos financeiros de mesa/caixa permanecem nos
    renderers validados existentes. Pedidos passam pelo domínio de impressão.
    Assim podemos migrar consumidores sem trocar hardware nem quebrar contratos.
    """

    @classmethod
    def request_print(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
        if intent.source_type == PrintSourceType.ORDER:
            return cls._request_order(db, intent)
        if intent.source_type == PrintSourceType.TABLE:
            return cls._request_table(db, intent)
        if intent.source_type == PrintSourceType.CASH_SHIFT:
            return cls._request_cash_shift(db, intent)
        raise UniversalPrintingError("Origem de impressão inválida", status_code=422)

    @classmethod
    def _request_table(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
        try:
            mesa_id = int(intent.table_id or intent.source_id)
        except (TypeError, ValueError) as exc:
            raise UniversalPrintingError("Mesa de impressão inválida", status_code=422) from exc

        apenas_valores = bool(
            intent.values_only or intent.action == PrintAction.CLOSING
        )
        job = enqueue_table_receipt(
            db,
            intent.restaurant_id,
            mesa_id,
            apenas_valores=apenas_valores,
            source_type="mesa",
            source_id=str(mesa_id),
            idempotency_key=intent.idempotency_key,
            printed_by=intent.requested_by,
        )
        return [job] if job is not None else []

    @classmethod
    def _request_cash_shift(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
        try:
            turno_id = int(intent.source_id)
        except (TypeError, ValueError) as exc:
            raise UniversalPrintingError("Turno de caixa inválido", status_code=422) from exc
        job = enqueue_cash_closing_receipt(
            db,
            intent.restaurant_id,
            turno_id,
        )
        return [job] if job is not None else []

    @classmethod
    def _request_order(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
        lancamento, comanda, source_items = cls._load_order_source(
            db,
            intent.restaurant_id,
            intent.source_id,
        )

        # Consumo no local mantém o snapshot parcial/financeiro já validado.
        # A entrada, porém, já é universal: a rota não escolhe formatter.
        if cls._is_dine_in(comanda):
            mesa_id = intent.table_id or comanda.mesa_id
            if mesa_id is None:
                raise UniversalPrintingError(
                    "Pedido local não possui mesa para impressão",
                    status_code=409,
                )
            source_id = lancamento.id if lancamento is not None else comanda.id
            source_type = (
                "reimpressao"
                if intent.action == PrintAction.REPRINT
                else ("lancamento" if lancamento is not None else "pedido")
            )
            job = enqueue_table_receipt(
                db,
                intent.restaurant_id,
                int(mesa_id),
                apenas_valores=False,
                source_type=source_type,
                source_id=source_id,
                idempotency_key=intent.idempotency_key,
            )
            return [job] if job is not None else []

        active_items = [
            item
            for item in source_items
            if item.status != "cancelado" and item.produto is not None
        ]
        if not active_items:
            raise UniversalPrintingError(
                "Não há itens ativos neste pedido para imprimir",
                status_code=400,
            )

        preferences = get_print_preferences(db, intent.restaurant_id)
        source_time = (
            lancamento.timestamp
            if lancamento is not None
            else comanda.criado_em
        )
        local_time = to_operational_local_time(source_time)
        garcom_nome = cls._operator_name(lancamento, comanda)
        print_items = [cls._to_print_item(item) for item in active_items]

        document = OrderPrintData(
            restaurante_nome=preferences.restaurant_name,
            numero_pedido=str(comanda.numero_pedido or ""),
            tipo_pedido=comanda.tipo,
            mesa=str(comanda.mesa_id) if comanda.mesa_id else "BALCAO",
            horario=(local_time.strftime("%H:%M") if local_time else ""),
            garcom_nome=garcom_nome,
            numero_lancamento=(lancamento.id if lancamento is not None else None),
            itens=print_items,
            is_reprint=(intent.action == PrintAction.REPRINT),
        )
        documents = PrintDocumentService.generate_production(document) or {}
        if not documents:
            raise UniversalPrintingError(
                "A política de impressão não gerou documento para este pedido",
                status_code=409,
            )

        jobs: list[PrintJob] = []
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y%m%d%H%M%S%f"
        )
        source_id = lancamento.id if lancamento is not None else comanda.id
        for destination, payload in documents.items():
            destination_key = str(destination).strip().upper() or "COZINHA"
            if intent.idempotency_key:
                idempotency_key = f"{intent.idempotency_key}:{destination_key.lower()}"
            elif intent.action == PrintAction.REPRINT:
                idempotency_key = (
                    f"universal:reimpressao:{source_id}:{destination_key.lower()}:{stamp}"
                )
            else:
                idempotency_key = (
                    f"universal:pedido:{source_id}:{destination_key.lower()}"
                )

            job = enqueue_print_job(
                db,
                restaurante_id=intent.restaurant_id,
                document_type="producao",
                destination=destination_key,
                source_type=(
                    "reimpressao"
                    if intent.action == PrintAction.REPRINT
                    else "pedido"
                ),
                source_id=source_id,
                payload_text=payload,
                idempotency_key=idempotency_key,
            )
            if job is not None:
                jobs.append(job)
        return jobs

    @staticmethod
    def _load_order_source(
        db: Session,
        restaurant_id: int,
        source_id: str,
    ) -> tuple[Optional[Lancamento], Comanda, list[Item]]:
        source_id = str(source_id or "").strip()
        lancamento: Optional[Lancamento] = None
        comanda: Optional[Comanda] = None

        if source_id.startswith("l-"):
            lancamento = (
                db.query(Lancamento)
                .options(
                    joinedload(Lancamento.comanda).joinedload(Comanda.criada_por),
                    joinedload(Lancamento.garcom),
                    joinedload(Lancamento.itens).joinedload(Item.produto),
                )
                .filter(
                    Lancamento.restaurante_id == restaurant_id,
                    Lancamento.id == source_id,
                )
                .first()
            )
            if lancamento is not None:
                comanda = lancamento.comanda
                source_items = list(lancamento.itens)
            else:
                source_items = []
        else:
            source_items = []

        if comanda is None:
            comanda = (
                db.query(Comanda)
                .options(
                    joinedload(Comanda.itens).joinedload(Item.produto),
                    joinedload(Comanda.criada_por),
                    joinedload(Comanda.lancamentos).joinedload(Lancamento.garcom),
                )
                .filter(
                    Comanda.restaurante_id == restaurant_id,
                    Comanda.id == source_id,
                )
                .first()
            )
            if comanda is not None:
                source_items = list(comanda.itens)
                launches = sorted(
                    list(comanda.lancamentos or []),
                    key=lambda launch: (
                        launch.timestamp or datetime.datetime.min.replace(
                            tzinfo=datetime.timezone.utc
                        ),
                        launch.id,
                    ),
                )
                lancamento = launches[0] if launches else None

        if comanda is None or comanda.restaurante_id != restaurant_id:
            raise UniversalPrintingError("Pedido não encontrado", status_code=404)
        return lancamento, comanda, source_items

    @staticmethod
    def _operator_name(
        lancamento: Optional[Lancamento],
        comanda: Comanda,
    ) -> str:
        if lancamento is not None and lancamento.garcom is not None:
            return lancamento.garcom.nome
        if comanda.criada_por is not None:
            return comanda.criada_por.nome
        return "OPERADOR"

    @staticmethod
    def _to_print_item(item: Item) -> PrintItem:
        produto = item.produto
        categoria = produto.categoria if produto is not None else None
        destination = (
            categoria.destino_impressao
            if categoria is not None and categoria.destino_impressao
            else "COZINHA"
        )
        return PrintItem(
            codigo=str(
                getattr(produto, "codigo", None)
                or getattr(produto, "id", None)
                or item.produto_id
                or ""
            ),
            nome=(produto.nome if produto is not None else "Item"),
            quantidade=1,
            preco_unit=float(item.preco_unit or 0.0),
            cliente_nome=item.cliente_nome or "GERAL",
            observacao=item.observacao or "",
            destino_impressao=str(destination),
        )

    @staticmethod
    def _is_dine_in(comanda: Comanda) -> bool:
        normalized = str(comanda.tipo or "").strip().casefold()
        return normalized not in {
            "retirada",
            "viagem",
            "delivery",
            "entrega",
        }
