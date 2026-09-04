"""Rotas públicas de pedidos sobre o ciclo de vida canônico.

``orders_core`` mantém rotas e callbacks compartilhados durante a migração. As
rotas de delivery/retirada deste módulo não escrevem estado de pedido
 diretamente: elas traduzem o contrato HTTP legado para o Core de Aplicação.
"""

from __future__ import annotations

from fastapi import BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..application.orders.lifecycle import (
    LEGACY_ORDER_STATUS_INPUTS,
    OrderLifecycleCoordinator,
)
from ..application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintTrigger,
    PrintingApplicationService,
    UniversalPrintingError,
)
from ..database import current_restaurante_id, get_db, require_tenant_id
from ..domain.orders.errors import InvalidOrderTransitionError, OrderValidationError
from ..domain.orders.types import (
    OrderStatus,
    normalize_to_order_status,
    to_legacy_order_status,
)
from ..models import Comanda, Motoboy, Restaurante, Usuario
from ..schemas import ComandaResponse
from ..security import motoboy_rate_limiter, require_permission, verify_motoboy_token
from ..services.notificacoes import agendar_notificacao_whatsapp_task
from ..services.shifts import require_open_cash_shift
from ..websocket_manager import manager

# Compatibilidade Python explícita para os adapters e callbacks ainda em migração.
from .orders_core import (
    _agendar_notificacao_whatsapp_status,
    _criar_acesso_motoboy,
    criar_venda_direta,
    gerar_novo_numero_pedido,
    lancar_itens,
    logger,
    router,
)


def _canonical_target_or_422(raw_status: str) -> str:
    target = (raw_status or "").strip().casefold()
    if target not in LEGACY_ORDER_STATUS_INPUTS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Status inválido. Use um de: "
                + ", ".join(sorted(LEGACY_ORDER_STATUS_INPUTS))
            ),
        )
    return target


def _transition_via_application_or_http(
    db: Session,
    *,
    restaurant_id: int,
    comanda_id: str,
    target_status: str,
    operator_user_id: str | int | None,
    courier_id: str | int | None = None,
    reason: str | None = None,
):
    try:
        return OrderLifecycleCoordinator.transition_check_status(
            db,
            restaurant_id=restaurant_id,
            comanda_id=comanda_id,
            target_status=target_status,
            operator_user_id=operator_user_id,
            courier_id=courier_id,
            reason=reason,
            commit=False,
        )
    except InvalidOrderTransitionError as exc:
        db.rollback()
        current = to_legacy_order_status(normalize_to_order_status(exc.current_status))
        target = to_legacy_order_status(normalize_to_order_status(exc.target_status))
        allowed = sorted(
            {
                to_legacy_order_status(normalize_to_order_status(candidate))
                for candidate in exc.allowed_targets
            }
        )
        allowed_text = ", ".join(allowed) if allowed else "nenhum"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Transição de status inválida: {current} → {target}. "
                f"Próximos status permitidos: {allowed_text}."
            ),
        ) from exc
    except OrderValidationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


def _is_delivery(comanda: Comanda) -> bool:
    return (comanda.tipo or "").strip().casefold() in {"delivery", "entrega"}


def _is_delivery_or_pickup(comanda: Comanda) -> bool:
    return (comanda.tipo or "").strip().casefold() in {
        "delivery",
        "entrega",
        "retirada",
        "viagem",
    }


def _normalize_legacy_progress_target(comanda: Comanda, target: str) -> str:
    """Traduz a CTA antiga de produção para o próximo estado canônico.

    O Caixa legado ainda envia ``transito`` ao clicar na ação visual que significa
    "pedido pronto". A tradução acontece somente quando o pedido já está em
    produção; assim o Core continua proibindo saltos reais. Em pedidos já
    prontos, ``transito`` continua significando despacho de delivery.
    """
    current = normalize_to_order_status(comanda.delivery_status)
    if current == OrderStatus.PREPARING and target == "transito":
        return "pronto"
    return target


@router.put("/{comanda_id}/delivery/status", response_model=ComandaResponse)
def atualizar_status_delivery(
    comanda_id: str,
    status_novo: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("pedidos:alterar_status")),
):
    """Adapta o status legado para os comandos canônicos do ciclo de vida."""
    target = _canonical_target_or_422(status_novo)
    rid = require_tenant_id()
    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rid,
            Comanda.id == comanda_id,
        )
        .with_for_update()
        .first()
    )
    if not comanda:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    if not _is_delivery_or_pickup(comanda):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A comanda informada não é um pedido de delivery ou retirada.",
        )

    target = _normalize_legacy_progress_target(comanda, target)
    current_status = normalize_to_order_status(comanda.delivery_status)
    target_status = normalize_to_order_status(target)
    # Trânsito de delivery deve sempre possuir entregador. A rota dedicada de
    # despacho faz vínculo + transição atomicamente; o Core repete essa proteção
    # para qualquer futuro consumidor que não passe por esta rota.
    if target_status == OrderStatus.DISPATCHED and _is_delivery(comanda) and not comanda.motoboy_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vincule um motoboy usando a ação de despacho antes de iniciar a entrega.",
        )

    if current_status == OrderStatus.PENDING and target_status == OrderStatus.PREPARING:
        require_open_cash_shift(db, rid)

    status_anterior = to_legacy_order_status(current_status)
    transition = _transition_via_application_or_http(
        db,
        restaurant_id=rid,
        comanda_id=comanda.id,
        target_status=target,
        operator_user_id=getattr(current_user, "id", None),
        courier_id=(
            comanda.motoboy_id
            if target_status == OrderStatus.DISPATCHED
            else None
        ),
        reason=(
            "Recusado/cancelado pela operação via ciclo de delivery"
            if target_status in {OrderStatus.REJECTED, OrderStatus.CANCELLED}
            else None
        ),
    )
    if not transition.changed:
        return transition.comanda

    if transition.first_accept:
        try:
            PrintingApplicationService.request_print(
                db,
                PrintIntent(
                    restaurant_id=rid,
                    source_type=PrintSourceType.ORDER,
                    source_id=comanda.id,
                    action=PrintAction.PRINT,
                    trigger=PrintTrigger.AUTOMATIC,
                    requested_by=current_user.nome,
                    idempotency_key=f"aceite:pedido:{comanda.id}:producao",
                ),
            )
        except UniversalPrintingError as print_err:
            logger.warning(
                "Falha no Core Universal de Impressão ao aceitar pedido %s: %s",
                comanda.id,
                print_err,
            )

    db.commit()
    db.refresh(comanda)
    target_legacy = to_legacy_order_status(transition.target_status)
    _agendar_notificacao_whatsapp_status(
        background_tasks,
        db,
        comanda,
        status_anterior,
        target_legacy,
    )
    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated"},
        rid,
    )
    return comanda


@router.post("/{comanda_id}/delivery/despachar", response_model=ComandaResponse)
def despachar_delivery(
    comanda_id: str,
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("pedidos:alterar_status")),
):
    """Vincula motoboy e delega a transição pronto -> trânsito ao Core."""
    rid = require_tenant_id()
    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rid,
            Comanda.id == comanda_id,
        )
        .with_for_update()
        .first()
    )
    if not comanda:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    if not _is_delivery(comanda):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Somente pedidos de delivery podem ser despachados para motoboy.",
        )

    motoboy_id = payload.get("motoboy_id")
    if not motoboy_id:
        raise HTTPException(status_code=400, detail="motoboy_id obrigatório")

    motoboy = db.query(Motoboy).filter(
        Motoboy.restaurante_id == rid,
        Motoboy.id == motoboy_id,
        Motoboy.ativo.is_(True),
    ).first()
    if not motoboy:
        raise HTTPException(status_code=404, detail="Motoboy ativo não encontrado")

    current_status = normalize_to_order_status(comanda.delivery_status)
    if current_status == OrderStatus.DISPATCHED:
        if comanda.motoboy_id not in {None, motoboy_id}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este pedido já está em trânsito com outro motoboy.",
            )
        if comanda.motoboy_id is None:
            # Reparação logística compatível para registros legados. Não altera
            # o estado do pedido; somente restaura o vínculo com o entregador.
            comanda.motoboy_id = motoboy_id
            db.commit()
            db.refresh(comanda)
        return comanda

    status_anterior = to_legacy_order_status(current_status)
    acesso_motoboy = _criar_acesso_motoboy(db, motoboy, rid)

    _transition_via_application_or_http(
        db,
        restaurant_id=rid,
        comanda_id=comanda.id,
        target_status="transito",
        operator_user_id=getattr(current_user, "id", None),
        courier_id=motoboy_id,
    )

    try:
        PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=rid,
                source_type=PrintSourceType.ORDER,
                source_id=comanda.id,
                action=PrintAction.DISPATCH,
                trigger=PrintTrigger.AUTOMATIC,
                requested_by=current_user.nome,
                courier_name=motoboy.nome,
                idempotency_key=f"despacho:pedido:{comanda.id}",
            ),
        )
    except UniversalPrintingError as print_err:
        logger.warning(
            "Falha no Core Universal de Impressão ao despachar pedido %s: %s",
            comanda.id,
            print_err,
        )

    db.commit()
    db.refresh(comanda)

    restaurante = db.query(Restaurante).filter(Restaurante.id == rid).first()
    nome_restaurante = restaurante.nome if restaurante else "Kôma"
    total_pedido = sum(
        float(item.preco_unit or 0)
        for item in comanda.itens
        if item.status != "cancelado"
    ) + float(comanda.delivery_taxa or 0)
    valor_a_cobrar = max(0.0, total_pedido - float(comanda.valor_pago or 0))
    mensagem_motoboy = (
        f"*NOVA ENTREGA - {nome_restaurante}*\n\n"
        f"*Pedido:* #{comanda.numero_pedido or comanda.id}\n"
        f"*Cliente:* {comanda.identificador or 'Cliente'}\n"
        f"*Endereço:* {comanda.delivery_endereco or 'Não informado'}\n"
        f"*Telefone do cliente:* {comanda.delivery_telefone or 'Não informado'}\n"
        f"*Valor a cobrar:* R$ {valor_a_cobrar:.2f}\n\n"
        f"*Painel do entregador:* {acesso_motoboy['link_publico']}"
    )
    agendar_notificacao_whatsapp_task(
        background_tasks,
        telefone=motoboy.telefone,
        conteudo=mensagem_motoboy,
        tipo="atribuicao_motoboy",
        restaurante_id=rid,
        comanda_id=comanda.id,
        conteudo_auditoria=(
            f"Atribuição do pedido {comanda.id} ao motoboy {motoboy.id}."
        ),
        contexto=f"atribuição de entrega (comanda #{comanda.id})",
    )
    _agendar_notificacao_whatsapp_status(
        background_tasks,
        db,
        comanda,
        status_anterior,
        "transito",
    )
    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated"},
        rid,
    )
    return comanda


@router.post("/motoboys/pedidos/{comanda_id}/confirmar-entrega")
def confirmar_entrega_motoboy(
    comanda_id: str,
    token: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Confirma a entrega usando a mesma autoridade canônica de lifecycle."""
    motoboy_rate_limiter.check(request)
    token_data = verify_motoboy_token(token, db)
    motoboy_id = token_data["motoboy_id"]
    rest_id = token_data["restaurante_id"]
    tenant_token = current_restaurante_id.set(rest_id)
    try:
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.id == comanda_id,
                Comanda.restaurante_id == rest_id,
            )
            .with_for_update()
            .first()
        )
        if not comanda:
            raise HTTPException(status_code=404, detail="Pedido não encontrado")
        if not _is_delivery(comanda):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O pedido informado não é uma entrega por motoboy.",
            )
        if comanda.motoboy_id not in {None, motoboy_id}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este pedido pertence a outro motoboy.",
            )

        current_status = normalize_to_order_status(comanda.delivery_status)
        if current_status == OrderStatus.COMPLETED:
            return {"status": "sucesso", "mensagem": "Entrega já estava confirmada."}

        status_anterior = to_legacy_order_status(current_status)
        if comanda.motoboy_id is None:
            # Compatibilidade para despachos legados que chegaram a trânsito sem
            # persistir o vínculo. O status continua sendo alterado somente pelo Core.
            comanda.motoboy_id = motoboy_id

        _transition_via_application_or_http(
            db,
            restaurant_id=rest_id,
            comanda_id=comanda.id,
            target_status="finalizado",
            operator_user_id=None,
            courier_id=motoboy_id,
        )
        db.commit()
        db.refresh(comanda)

        _agendar_notificacao_whatsapp_status(
            background_tasks,
            db,
            comanda,
            status_anterior,
            "entregue",
        )
        background_tasks.add_task(
            manager.broadcast,
            {"event": "tables_updated"},
            rest_id,
        )
        return {"status": "sucesso", "mensagem": "Entrega confirmada com sucesso!"}
    finally:
        current_restaurante_id.reset(tenant_token)
