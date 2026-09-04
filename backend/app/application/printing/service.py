from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from ...domain.printing import (
    PrintItem,
    group_items_by_print_destination,
)
from ...models import Comanda, ConfiguracaoRestaurante, Item, Lancamento, PrintJob
from ...printer_service import printer_service
from ...services.atendimentos import AtendimentoError, ensure_launch_identity
from ...services.printing import (
    PrintingRequestError,
    enqueue_cash_closing_receipt,
    enqueue_print_job,
    enqueue_table_receipt,
    get_print_preferences,
)
from .comanda_renderer import ComandaVariant, render_canonical_comanda
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
            if intent.source_type == PrintSourceType.ITEM:
                # Import local evita ciclo: o documento delta reutiliza o erro
                # público deste módulo, mas continua atrás desta entrada única.
                from .item_change import ItemChangePrintingService

                return ItemChangePrintingService.request_print(db, intent)
            if intent.action == PrintAction.ITEM_CHANGE:
                raise UniversalPrintingError(
                    "Alteração de item exige origem de impressão item",
                    status_code=422,
                )
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
        except Exception as exc:
            raise UniversalPrintingError(
                "Falha inesperada no motor de impressão",
                status_code=500,
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
        """Renderiza pedido local diretamente na fonte canônica de comandas."""
        requested_source_id = str(intent.source_id or "").strip()
        requested_is_launch = requested_source_id.startswith("l-")
        mesa_id = intent.table_id or comanda.mesa_id
        if mesa_id is None:
            raise UniversalPrintingError(
                "Pedido local não possui mesa para impressão",
                status_code=409,
            )
        mesa_id = int(mesa_id)

        # Lançamentos podem ser divididos entre mesas. A identidade humana é do
        # lançamento original, mas cada via contém somente os itens que estão na
        # mesa solicitada no momento da impressão.
        active_items = [
            item
            for item in cls._active_items(source_items)
            if item.comanda is not None
            and item.comanda.restaurante_id == intent.restaurant_id
            and item.comanda.mesa_id == mesa_id
        ]
        if not active_items:
            raise UniversalPrintingError(
                "Não há itens ativos neste pedido para imprimir",
                status_code=400,
            )

        if (
            intent.trigger == PrintTrigger.AUTOMATIC
            and not any(cls._item_has_production_destination(item) for item in active_items)
        ):
            return []

        # O PDV historicamente identifica a via pela Comanda que acabou de criar;
        # Garçom identifica pelo Lançamento incremental. O Core preserva essas
        # identidades sem deixar a borda escolher formatter ou PrintJob.
        is_pos_source = bool(
            lancamento is not None
            and str(lancamento.origem or "").strip().casefold() in {"caixa", "smartpos"}
        )
        source_id = (
            comanda.id
            if is_pos_source
            else lancamento.id
            if requested_is_launch and lancamento is not None
            else comanda.id
        )
        if intent.action == PrintAction.REPRINT:
            source_type = "reimpressao"
        elif is_pos_source:
            source_type = "pedido"
        elif requested_is_launch and lancamento is not None:
            source_type = "lancamento"
        else:
            source_type = "pedido"

        try:
            order_number: object = (
                ensure_launch_identity(db, lancamento).label
                if lancamento is not None
                else comanda.numero_pedido
            )
        except AtendimentoError as exc:
            raise UniversalPrintingError(str(exc), status_code=exc.status_code) from exc

        preferences = get_print_preferences(db, intent.restaurant_id)
        source_time = (
            lancamento.timestamp
            if requested_is_launch and lancamento is not None
            else comanda.criado_em
        )
        operator_name = cls._operator_name(lancamento, comanda)
        print_items = [cls._to_print_item(item) for item in active_items]
        payload = render_canonical_comanda(
            restaurant_name=preferences.restaurant_name,
            restaurant_name_position=preferences.restaurant_name_position,
            print_footer=preferences.print_footer,
            order_number=order_number,
            order_type=comanda.tipo,
            operator_name=operator_name,
            items=print_items,
            variant=ComandaVariant(
                location_label=None,
                operator_label="GARÇOM",
                is_reprint=(intent.action == PrintAction.REPRINT),
                event_at=source_time,
                table_id=mesa_id,
                preserve_item_customers=True,
            ),
        )

        idempotency_key = intent.idempotency_key
        if not idempotency_key and intent.trigger == PrintTrigger.AUTOMATIC:
            idempotency_key = f"universal:auto:{source_id}:mesa:{mesa_id}"
        if not idempotency_key:
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime(
                "%Y%m%d%H%M%S%f"
            )
            idempotency_key = f"mesa:parcial:{mesa_id}:{stamp}"

        job = enqueue_print_job(
            db,
            restaurante_id=intent.restaurant_id,
            document_type="producao",
            destination="COZINHA",
            source_type=source_type,
            source_id=source_id,
            payload_text=payload,
            idempotency_key=idempotency_key,
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
        """Gera pedido remoto pela mesma fonte visual usada pelo salão.

        A via primária sempre contém o pedido remoto completo. Destinos
        adicionais (BAR etc.) continuam recebendo suas vias setoriais, mas todos
        os papéis passam pelo mesmo modelo canônico de comanda.
        """
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
        print_items = [cls._to_print_item(item) for item in active_items]

        routed_items = {
            destination: list(items)
            for destination, items in group_items_by_print_destination(print_items).items()
        }
        primary_destination = (
            "COZINHA"
            if "COZINHA" in routed_items
            else next(iter(routed_items), "COZINHA")
        )
        # Pedido remoto nunca pode desaparecer nem perder bebida/NENHUM da via
        # operacional. A via primária funciona também como expedição do pedido.
        routed_items[primary_destination] = list(print_items)

        origin_label = cls._origin_label(lancamento)
        customer_name = str(comanda.identificador or "").strip() or None
        is_delivery = cls._is_delivery_type(comanda.tipo)
        operator_name = cls._operator_name(lancamento, comanda)

        jobs: list[PrintJob] = []
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y%m%d%H%M%S%f"
        )
        for destination, destination_items in routed_items.items():
            destination_key = str(destination).strip().upper() or "COZINHA"
            is_primary = destination_key == str(primary_destination).strip().upper()
            variant = ComandaVariant(
                origin_label=origin_label,
                location_label="ENTREGA" if is_delivery else "BALCÃO",
                operator_label="OPERADOR",
                customer_name=customer_name if is_primary else None,
                is_reprint=(intent.action == PrintAction.REPRINT),
                event_at=source_time,
                via_label=None if is_primary else destination_key,
                delivery_phone=(comanda.delivery_telefone if is_delivery and is_primary else None),
                delivery_address=(comanda.delivery_endereco if is_delivery and is_primary else None),
                delivery_neighborhood=(comanda.delivery_bairro if is_delivery and is_primary else None),
                payment_method=(comanda.delivery_forma_pagamento if is_delivery and is_primary else None),
                change_for=(
                    float(comanda.delivery_troco_para)
                    if is_delivery
                    and is_primary
                    and comanda.delivery_troco_para is not None
                    else None
                ),
                delivery_fee=(
                    float(comanda.delivery_taxa or 0.0)
                    if is_delivery and is_primary
                    else 0.0
                ),
            )
            payload = render_canonical_comanda(
                restaurant_name=preferences.restaurant_name,
                restaurant_name_position=preferences.restaurant_name_position,
                print_footer=preferences.print_footer,
                order_number=comanda.numero_pedido,
                order_type=comanda.tipo,
                operator_name=operator_name,
                items=destination_items,
                variant=variant,
            )

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
        """Centraliza as vias de despacho sem alterar o layout físico atual."""
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
                    joinedload(Lancamento.itens).joinedload(Item.comanda),
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
    def _origin_label(lancamento: Optional[Lancamento]) -> str:
        origin = str(lancamento.origem if lancamento is not None else "").strip().casefold()
        return {
            "cardapio": "CARDÁPIO ONLINE",
            "caixa": "CAIXA / PDV",
            "smartpos": "SMARTPOS",
            "garcom": "GARÇOM",
        }.get(origin, "PEDIDO")

    @staticmethod
    def _is_delivery_type(tipo: object) -> bool:
        normalized = str(tipo or "").strip().casefold()
        return any(term in normalized for term in ("delivery", "entrega"))

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
