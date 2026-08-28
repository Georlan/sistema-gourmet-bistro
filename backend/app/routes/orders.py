"""Rotas públicas de pedidos com state machine hardened para delivery.

O módulo legado completo fica em ``orders_core`` para manter compatibilidade de
imports. As três rotas que alteram o ciclo de vida de delivery são substituídas
aqui por boundaries que compartilham a mesma máquina de estados.
"""

from __future__ import annotations

import datetime

from fastapi import BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import current_restaurante_id, get_db, require_tenant_id
from ..models import Comanda, ConfiguracaoRestaurante, Motoboy, Restaurante, Usuario
from ..schemas import ComandaResponse
from ..security import motoboy_rate_limiter, require_permission, verify_motoboy_token
from ..services.inventory import consumir_estoque_dos_itens, estornar_estoque_dos_itens
from ..services.order_state_machine import (
    CANONICAL_ORDER_STATUSES,
    InvalidOrderTransition,
    normalize_order_status,
    validate_order_transition,
)
from ..services.notificacoes import agendar_notificacao_whatsapp_task
from ..websocket_manager import manager

# Reexporta a API estável do módulo histórico. Isso mantém imports como
# ``from .orders import gerar_novo_numero_pedido`` sem duplicar o monólito.
from .orders_core import *  # noqa: F401,F403
from .orders_core import (
    _criar_acesso_motoboy,
    _agendar_notificacao_whatsapp_status,
    enqueue_initial_production_for_order,
    print_in_background,
    require_open_cash_shift,
    router,
)


_LEGACY_DELIVERY_ENDPOINTS = {
    "atualizar_status_delivery",
    "despachar_delivery",
    "confirmar_entrega_motoboy",
}

# O APIRouter é o mesmo objeto criado pelo módulo histórico. Removemos somente
# os três handlers permissivos e registramos abaixo suas versões hardened.
router.routes[:] = [
    route
    for route in router.routes
    if getattr(getattr(route, "endpoint", None), "__name__", "")
    not in _LEGACY_DELIVERY_ENDPOINTS
]


def _canonical_target_or_422(raw_status: str) -> str:
    target = (raw_status or "").strip().casefold()
    if target not in CANONICAL_ORDER_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Status inválido. Use um de: "
                + ", ".join(sorted(CANONICAL_ORDER_STATUSES))
            ),
        )
    return target


def _transition_or_409(comanda: Comanda, target: str):
    try:
        return validate_order_transition(
            comanda.delivery_status,
            target,
            comanda.tipo,
        )
    except InvalidOrderTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
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
    produção; assim a state machine continua proibindo saltos reais e o estado
    persistido permanece ``pronto``. Em pedidos já prontos, ``transito`` continua
    significando despacho de delivery e segue as regras normais.
    """
    current = normalize_order_status(comanda.delivery_status)
    if current == "producao" and target == "transito":
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
    """Avança um pedido pela state machine canônica de delivery/retirada."""
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
    transition = _transition_or_409(comanda, target)
    if not transition.changed:
        return comanda

    # Trânsito de delivery deve sempre possuir entregador. A rota dedicada de
    # despacho faz vínculo + transição atomicamente.
    if target == "transito" and _is_delivery(comanda) and not comanda.motoboy_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vincule um motoboy usando a ação de despacho antes de iniciar a entrega.",
        )

    status_anterior = normalize_order_status(comanda.delivery_status)

    if transition.first_accept:
        require_open_cash_shift(db, rid)
        itens_ativos = [item for item in comanda.itens if item.status != "cancelado"]
        consumir_estoque_dos_itens(
            db,
            itens_ativos,
            usuario_id=current_user.id,
            liberar_pendente=True,
        )

    comanda.delivery_status = target

    if target in {"pronto", "transito", "finalizado"}:
        for item in comanda.itens:
            if item.status == "preparando":
                item.status = "pronto"

    if transition.first_accept:
        enqueue_initial_production_for_order(db, comanda)

    if target == "recusado":
        itens_cancelados = []
        for item in comanda.itens:
            if item.status != "cancelado":
                item.status = "cancelado"
                item.cancelado_por = current_user.id
                itens_cancelados.append(item)
        # Compatibilidade de rollout: pedidos pendentes antigos podem ter sido
        # baixados antes da 2B. O helper só estorna movimentos que realmente existem.
        estornar_estoque_dos_itens(
            db,
            itens_cancelados,
            usuario_id=current_user.id,
        )
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)

    if target == "finalizado":
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)

    db.commit()
    db.refresh(comanda)
    _agendar_notificacao_whatsapp_status(
        background_tasks,
        db,
        comanda,
        status_anterior,
        target,
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
    """Vincula motoboy e executa exclusivamente a transição pronto -> transito."""
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

    transition = _transition_or_409(comanda, "transito")
    if not transition.changed:
        if comanda.motoboy_id not in {None, motoboy_id}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este pedido já está em trânsito com outro motoboy.",
            )
        if comanda.motoboy_id is None:
            comanda.motoboy_id = motoboy_id
            db.commit()
            db.refresh(comanda)
        return comanda

    status_anterior = normalize_order_status(comanda.delivery_status)
    comanda.motoboy_id = motoboy_id
    comanda.delivery_status = "transito"
    acesso_motoboy = _criar_acesso_motoboy(db, motoboy, rid)

    # Mantém a via operacional já existente, mas só a gera na primeira transição
    # válida para trânsito; retries não reimprimem.
    try:
        from ..printer_service import printer_service

        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == rid,
        ).first()
        unificar = bool(config.unificar_vias_delivery) if config else False
        if unificar:
            unified_text = printer_service.generate_delivery_unified_ticket(
                comanda,
                motoboy.nome,
            )
            background_tasks.add_task(
                print_in_background,
                "delivery_unico",
                unified_text,
                restaurante_id=rid,
            )
        else:
            kitchen_text = printer_service.generate_delivery_kitchen_ticket(comanda)
            motoboy_text = printer_service.generate_delivery_motoboy_ticket(
                comanda,
                motoboy.nome,
            )
            background_tasks.add_task(
                print_in_background,
                "delivery_cozinha",
                kitchen_text,
                restaurante_id=rid,
            )
            background_tasks.add_task(
                print_in_background,
                "delivery_motoboy",
                motoboy_text,
                restaurante_id=rid,
            )
    except Exception:
        # Impressão de despacho é acessória: a transição operacional continua
        # registrada e o sistema de PrintJob/reimpressão pode recuperar a via.
        logger.exception("Falha ao preparar via de despacho do pedido %s", comanda.id)

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
    """Confirma apenas pedidos em trânsito pertencentes ao motoboy autenticado."""
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

        transition = _transition_or_409(comanda, "finalizado")
        if not transition.changed:
            return {"status": "sucesso", "mensagem": "Entrega já estava confirmada."}

        status_anterior = normalize_order_status(comanda.delivery_status)
        comanda.delivery_status = "finalizado"
        comanda.motoboy_id = motoboy_id
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
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
