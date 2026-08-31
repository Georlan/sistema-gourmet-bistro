from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from ...domain.printing import OrderPrintData, PrintDocumentService, PrintItem
from ...models import Comanda, ConfiguracaoRestaurante, Item, Lancamento, PrintJob
from ...printer_service import printer_service
from ...services.printing import (
    PrintingRequestError,
    enqueue_cash_closing_receipt,
    enqueue_print_job,
    enqueue_table_receipt,
    get_print_preferences,
)
from ...timezone_utils import to_operational_local_time
from .engine import PrintEngineType, resolve_order_engine
from .intent import PrintAction, PrintIntent, PrintSourceType, PrintTrigger


class UniversalPrintingError(PrintingRequestError):
    """Erro do Core Universal de Impressão traduzível na borda HTTP."""


class PrintingApplicationService:
    """Orquestrador canônico: intenção -> motor -> documento -> PrintJob.

    Nenhuma borda escolhe formatter, destino ou payload térmico. A entrada é
    universal; o Core resolve o motor semântico pelo tipo real do pedido e só
    então gera o documento e enfileira o trabalho físico.
    """

    @classmethod
    def request_print(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
        try:
            engine, order_context = cls._resolve_engine(db, intent)
            if engine == PrintEngineType.TABLE_RECEIPT:
                return cls._run_table_engine(db, intent)
            if engine == PrintEngineType.CASH_CLOSING:
                return cls._run_cash_engine(db, intent)
            if order_context is None:
                raise UniversalPrintingError(
                    "Contexto de pedido não resolvido para impressão",
                    status_code=500,
                )

            lancamento, comanda, source_items = order_context
            if engine == PrintEngineType.DINE_IN_ORDER:
                if intent.action == PrintAction.DISPATCH:
                    raise UniversalPrintingError(
                        "Pedido local não possui impressão de despacho",
                        status_code=422,
                    )
                return cls._run_dine_in_order_engine(
                    db,
                    intent,
                    lancamento,
                    comanda,
                    source_items,
                )
            if engine in {
                PrintEngineType.PICKUP_ORDER,
                PrintEngineType.DELIVERY_ORDER,
            }:
                if intent.action == PrintAction.DISPATCH:
                    if engine != PrintEngineType.DELIVERY_ORDER:
                        raise UniversalPrintingError(
                            "Somente delivery possui impressão de despacho",
                            status_code=422,
                        )
                    return cls._run_delivery_dispatch_engine(
                        db,
                        intent,
                        comanda,
                    )
                return cls._run_remote_order_engine(
                    db,
                    intent,
                    lancamento,
                    comanda,
                    source_items,
                )
            raise UniversalPrintingError("Motor de impressão inválido", status_code=422)
        except UniversalPrintingError:
            raise
        except PrintingRequestError as exc:
            raise UniversalPrintingError(
                str(exc),
                status_code=exc.status_code,
            ) from exc

    @classmethod
    def _resolve_engine(
        cls,
        db: Session,
        intent: PrintIntent,
    ) -> tuple[
        PrintEngineType,
        Optional[tuple[Optional[Lancamento], Comanda, list[Item]]],
    ]:
        """Resolve o motor antes de qualquer geração de documento."""
        if intent.source_type == PrintSourceType.TABLE:
            return PrintEngineType.TABLE_RECEIPT, None
        if intent.source_type == PrintSourceType.CASH_SHIFT:
            return PrintEngineType.CASH_CLOSING, None
        if intent.source_type != PrintSourceType.ORDER:
            raise UniversalPrintingError("Origem de impressão inválida", status_code=422)

        order_context = cls._load_order_source(
            db,
            intent.restaurant_id,
            str(intent.source_id or "").strip(),
        )
        _lancamento, comanda, _items = order_context
        return resolve_order_engine(comanda.tipo), order_context

    @classmethod
    def _run_table_engine(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
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
    def _run_cash_engine(cls, db: Session, intent: PrintIntent) -> list[PrintJob]:
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
    def _run_dine_in_order_engine(
        cls,
        db: Session,
        intent: PrintIntent,
        lancamento: Optional[Lancamento],
        comanda: Comanda,
        source_items: list[Item],
    ) -> list[PrintJob]:
        requested_source_id = str(intent.source_id or "").strip()
        requested_is_launch = requested_source_id.startswith("l-")
        mesa_id = intent.table_id or comanda.mesa_id
        if mesa_id is None:
            raise UniversalPrintingError(
                "Pedido local não possui mesa para impressão",
                status_code=409,
            )

        active_items = cls._active_items(source_items)
        if not active_items:
            raise UniversalPrintingError(
                "Não há itens ativos neste pedido para imprimir",
                status_code=400,
            )

        # Regra de negócio: lançamento local automático somente com itens NENHUM
        # permanece silencioso. Uma solicitação manual/reimpressão continua
        # imprimível e usa exatamente o mesmo motor/documento da origem.
        if (
            intent.trigger == PrintTrigger.AUTOMATIC
            and not any(cls._item_has_production_destination(item) for item in active_items)
        ):
            return []

        source_id = (
            lancamento.id
            if requested_is_launch and lancamento is not None
            else comanda.id
        )
        if intent.action == PrintAction.REPRINT:
            source_type = "reimpressao"
        elif requested_is_launch and lancamento is not None:
            source_type = "lancamento"
        else:
            source_type = "pedido"

        idempotency_key = intent.idempotency_key
        if not idempotency_key and intent.trigger == PrintTrigger.AUTOMATIC:
            idempotency_key = f"universal:auto:{source_id}:mesa:{int(mesa_id)}"

        job = enqueue_table_receipt(
            db,
            intent.restaurant_id,
            int(mesa_id),
            apenas_valores=False,
            source_type=source_type,
            source_id=source_id,
            idempotency_key=idempotency_key,
            printed_by=intent.requested_by,
        )
        jobs = [job] if job is not None else []
        if jobs:
            cls._mark_items_printed(active_items)
        return jobs

    @classmethod
    def _run_remote_order_engine(
        cls,
        db: Session,
        intent: PrintIntent,
        lancamento: Optional[Lancamento],
        comanda: Comanda,
        source_items: list[Item],
    ) -> list[PrintJob]:
        requested_source_id = str(intent.source_id or "").strip()
        requested_is_launch = requested_source_id.startswith("l-")
        active_items = cls._active_items(source_items)
        if not active_items:
            raise UniversalPrintingError(
                "Não há itens ativos neste pedido para imprimir",
                status_code=400,
            )

        preferences = get_print_preferences(db, intent.restaurant_id)
        source_time = (
            lancamento.timestamp
            if requested_is_launch and lancamento is not None
            else comanda.criado_em
        )
        local_time = to_operational_local_time(source_time)
        print_items = [cls._to_print_item(item) for item in active_items]

        document = OrderPrintData(
            restaurante_nome=preferences.restaurant_name,
            numero_pedido=str(comanda.numero_pedido or ""),
            tipo_pedido=comanda.tipo,
            mesa=str(comanda.mesa_id) if comanda.mesa_id else "BALCAO",
            horario=(local_time.strftime("%H:%M") if local_time else ""),
            garcom_nome=cls._operator_name(lancamento, comanda),
            numero_lancamento=(
                lancamento.id
                if requested_is_launch and lancamento is not None
                else None
            ),
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
        for destination, payload in documents.items():
            destination_key = str(destination).strip().upper() or "COZINHA"
            idempotency_key = cls._job_idempotency_key(
                intent,
                source_id=requested_source_id,
                destination=destination_key,
                stamp=stamp,
            )
            if intent.action == PrintAction.REPRINT:
                source_type = "reimpressao"
            elif requested_is_launch:
                source_type = "lancamento"
            else:
                source_type = "pedido"

            job = enqueue_print_job(
                db,
                restaurante_id=intent.restaurant_id,
                document_type="producao",
                destination=destination_key,
                source_type=source_type,
                source_id=requested_source_id,
                payload_text=payload,
                idempotency_key=idempotency_key,
            )
            if job is not None:
                jobs.append(job)

        if jobs:
            cls._mark_items_printed(active_items)
        return jobs

    @classmethod
    def _run_delivery_dispatch_engine(
        cls,
        db: Session,
        intent: PrintIntent,
        comanda: Comanda,
    ) -> list[PrintJob]:
        """Centraliza as vias de despacho sem alterar o layout físico atual.

        Os renderers legados de cozinha/motoboy continuam temporariamente atrás
        do Core. Na etapa visual serão substituídos pelo modelo canônico único,
        sem que a rota de pedidos volte a conhecer esses detalhes.
        """
        courier_name = str(intent.courier_name or "").strip()
        if not courier_name:
            raise UniversalPrintingError(
                "Nome do motoboy é obrigatório para impressão de despacho",
                status_code=422,
            )

        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == intent.restaurant_id,
        ).first()
        unified = bool(config.unificar_vias_delivery) if config else False

        payloads: list[tuple[str, str]]
        if unified:
            payloads = [
                (
                    "unico",
                    printer_service.generate_delivery_unified_ticket(
                        comanda,
                        courier_name,
                    ),
                )
            ]
        else:
            payloads = [
                (
                    "cozinha",
                    printer_service.generate_delivery_kitchen_ticket(comanda),
                ),
                (
                    "motoboy",
                    printer_service.generate_delivery_motoboy_ticket(
                        comanda,
                        courier_name,
                    ),
                ),
            ]

        jobs: list[PrintJob] = []
        for part, payload in payloads:
            base_key = intent.idempotency_key or f"universal:despacho:{comanda.id}"
            job = enqueue_print_job(
                db,
                restaurante_id=intent.restaurant_id,
                document_type="entrega",
                destination="ENTREGA",
                source_type="despacho",
                source_id=comanda.id,
                payload_text=payload,
                idempotency_key=f"{base_key}:{part}",
            )
            if job is not None:
                jobs.append(job)
        return jobs

    @staticmethod
    def _job_idempotency_key(
        intent: PrintIntent,
        *,
        source_id: str,
        destination: str,
        stamp: str,
    ) -> str:
        destination_key = destination.strip().lower()
        if intent.idempotency_key:
            return f"{intent.idempotency_key}:{destination_key}"
        if intent.action == PrintAction.REPRINT:
            return f"universal:reimpressao:{source_id}:{destination_key}:{stamp}"
        if intent.trigger == PrintTrigger.AUTOMATIC:
            return f"universal:auto:{source_id}:{destination_key}"
        return f"universal:pedido:{source_id}:{destination_key}"

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
                    key=lambda launch: (str(launch.timestamp or ""), launch.id),
                )
                lancamento = launches[0] if launches else None

        if comanda is None or comanda.restaurante_id != restaurant_id:
            raise UniversalPrintingError("Pedido não encontrado", status_code=404)
        return lancamento, comanda, source_items

    @staticmethod
    def _active_items(source_items: list[Item]) -> list[Item]:
        return [
            item
            for item in source_items
            if item.status != "cancelado" and item.produto is not None
        ]

    @staticmethod
    def _item_has_production_destination(item: Item) -> bool:
        produto = item.produto
        categoria = produto.categoria if produto is not None else None
        destination = (
            categoria.destino_impressao
            if categoria is not None and categoria.destino_impressao
            else "COZINHA"
        )
        return str(destination or "").strip().upper() not in {"NENHUM", "NONE", ""}

    @staticmethod
    def _mark_items_printed(items: list[Item]) -> None:
        printed_at = datetime.datetime.now(datetime.timezone.utc)
        for item in items:
            item.impresso_em = printed_at

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
