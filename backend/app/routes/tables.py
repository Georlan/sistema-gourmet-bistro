import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from typing import List
from ..database import get_db, require_tenant_id
from ..models import (
    Mesa,
    ObservacaoPredefinida,
    Comanda,
    Item,
    Usuario,
    Pagamento,
    OnlinePaymentIntent,
    ActivityLog,
)
from ..smartpos_models import SmartPosPaymentIntent
from ..schemas import (
    MesaResponse,
    MesaUpdate,
    MesaCreate,
    CancelarConsumoMesaRequest,
    CancelarItensMesaRequest,
    ObservacaoPredefinidaResponse,
)
from ..security import get_current_user, require_permission
from ..services.inventory import estornar_estoque_dos_itens
from ..websocket_manager import manager

router = APIRouter(
    prefix="/mesas",
    tags=["Mesas e Observações"]
)

# ----------------- TABLES ENDPOINTS -----------------
@router.get("/", response_model=List[MesaResponse])
def get_mesas(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna todas as mesas do salão com suas respectivas capacidades e nomes."""
    rest_id = require_tenant_id()
    return db.query(Mesa).filter(Mesa.restaurante_id == rest_id).order_by(Mesa.id).all()

@router.get("/{mesa_id}", response_model=MesaResponse)
def get_mesa(mesa_id: int, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Busca os detalhes de uma mesa específica pelo ID."""
    rest_id = require_tenant_id()
    mesa = db.query(Mesa).filter(Mesa.restaurante_id == rest_id, Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mesa não encontrada"
        )
    return mesa

@router.put("/{mesa_id}", response_model=MesaResponse)
def update_mesa(
    mesa_id: int, 
    update_data: MesaUpdate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar"))
):
    """Permite alterar a capacidade ou o nome personalizado da mesa."""
    rest_id = require_tenant_id()
    db_mesa = db.query(Mesa).filter(Mesa.restaurante_id == rest_id, Mesa.id == mesa_id).first()
    if not db_mesa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mesa não encontrada"
        )
        
    if update_data.nome is not None:
        db_mesa.nome = update_data.nome
    if update_data.capacidade is not None:
        db_mesa.capacidade = update_data.capacidade
        
    db.commit()
    db.refresh(db_mesa)
    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated", "detail": {"type": "layout_mesa_atualizado", "action": "updated", "mesa_id": mesa_id}},
        rest_id,
    )
    return db_mesa

@router.post("/", response_model=MesaResponse, status_code=status.HTTP_201_CREATED)
def create_mesa(
    mesa_in: MesaCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar"))
):
    """Cria uma nova mesa dinamicamente no salão."""
    rest_id = require_tenant_id()
    existing = db.query(Mesa).filter(Mesa.restaurante_id == rest_id, Mesa.id == mesa_in.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mesa com número {mesa_in.id} já existe."
        )
    nova_mesa = Mesa(
        id=mesa_in.id,
        restaurante_id=rest_id,
        capacidade=mesa_in.capacidade,
        nome=mesa_in.nome
    )
    db.add(nova_mesa)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Mesa com número {mesa_in.id} já existe.",
        ) from exc
    db.refresh(nova_mesa)
    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated", "detail": {"type": "layout_mesa_atualizado", "action": "created", "mesa_id": mesa_in.id}},
        rest_id,
    )
    return nova_mesa

@router.delete("/{mesa_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mesa(
    mesa_id: int, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar"))
):
    """Remove uma mesa do salão se ela não tiver nenhuma comanda ativa aberta."""
    rest_id = require_tenant_id()
    mesa = db.query(Mesa).filter(Mesa.restaurante_id == rest_id, Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mesa não encontrada"
        )
    comanda_ativa = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        or_(Comanda.mesa_id == mesa_id, Comanda.mesa_origem_id == mesa_id),
        Comanda.fechada == False,
    ).first()
    if comanda_ativa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível excluir uma mesa com comandas abertas."
        )
    # Dissocia comandas fechadas/antigas para evitar violações de chave estrangeira (FK constraints)
    # IMPORTANT: restaurante_id filter is mandatory here — bulk .update() bypasses ORM listeners
    db.query(Comanda).filter(
        Comanda.restaurante_id == mesa.restaurante_id,
        Comanda.mesa_id == mesa_id
    ).update({Comanda.mesa_id: None}, synchronize_session=False)
    db.delete(mesa)
    db.commit()
    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated", "detail": {"type": "layout_mesa_atualizado", "action": "deleted", "mesa_id": mesa_id}},
        rest_id,
    )
    return


@router.post("/{mesa_id}/cancelar-consumo")
def cancelar_consumo_mesa(
    mesa_id: int,
    payload: CancelarConsumoMesaRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("comandas:forcar_fechamento")),
):
    """Cancela todo o consumo aberto e libera a mesa sem fabricar quitação.

    Pagamentos manuais já aprovados permanecem registrados no caixa; o saldo
    restante não é marcado como pago. Confirmações pendentes são canceladas.
    Pagamentos confirmados por integração continuam bloqueando a operação.
    """
    rest_id = require_tenant_id()
    motivo = " ".join(payload.motivo.split())
    if len(motivo) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe um motivo válido com pelo menos 3 caracteres.",
        )

    mesa = db.query(Mesa).filter(
        Mesa.restaurante_id == rest_id,
        Mesa.id == mesa_id,
    ).first()
    if not mesa:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mesa não encontrada")

    comandas = (
        db.query(Comanda)
        .options(selectinload(Comanda.itens))
        .filter(
            Comanda.restaurante_id == rest_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
        )
        .with_for_update()
        .all()
    )
    if not comandas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A mesa já está livre e não possui consumo aberto.",
        )

    comanda_ids = [comanda.id for comanda in comandas]
    pagamentos_ativos = (
        db.query(Pagamento)
        .filter(
            Pagamento.restaurante_id == rest_id,
            Pagamento.comanda_id.in_(comanda_ids),
            or_(Pagamento.status.is_(None), Pagamento.status != "cancelado"),
        )
        .with_for_update()
        .all()
    )

    # Nesta fase do produto, pagamentos digitados manualmente pelo Caixa são
    # confirmações operacionais, não prova de liquidação externa. Ao destruir a
    # mesa, valores já confirmados continuam contabilizados como recebidos, mas
    # nenhum saldo restante é fabricado como pago. Confirmações ainda pendentes
    # são canceladas. Pagamentos cuja liquidação veio de um provedor continuam
    # protegidos: quando SmartPOS/checkout forem a autoridade do pagamento, a
    # mesa não poderá ignorar uma confirmação externa.
    pagamento_ids = [str(pagamento.id) for pagamento in pagamentos_ativos]
    pagamentos_integrados: set[str] = set()
    if pagamento_ids:
        pagamentos_integrados.update(
            str(row[0])
            for row in db.query(OnlinePaymentIntent.pagamento_id).filter(
                OnlinePaymentIntent.restaurante_id == rest_id,
                OnlinePaymentIntent.pagamento_id.in_(pagamento_ids),
            ).all()
            if row[0]
        )
        pagamentos_integrados.update(
            str(row[0])
            for row in db.query(SmartPosPaymentIntent.pagamento_id).filter(
                SmartPosPaymentIntent.restaurante_id == rest_id,
                SmartPosPaymentIntent.pagamento_id.in_(pagamento_ids),
                SmartPosPaymentIntent.captura == "provider_integrado",
            ).all()
            if row[0]
        )

    if pagamentos_integrados:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Há pagamento confirmado por integração nesta mesa. "
                "Esse recebimento precisa ser estornado ou reconciliado pelo provedor "
                "antes de cancelar o consumo."
            ),
        )

    pagamentos_manuais = [
        pagamento
        for pagamento in pagamentos_ativos
        if str(pagamento.id) not in pagamentos_integrados
    ]
    pagamentos_pendentes_cancelados = [
        pagamento for pagamento in pagamentos_manuais
        if pagamento.status == "pendente"
    ]
    pagamentos_manuais_preservados = [
        pagamento for pagamento in pagamentos_manuais
        if pagamento.status != "pendente"
    ]
    valor_pagamentos_preservados = round(
        sum(float(pagamento.valor or 0) for pagamento in pagamentos_manuais_preservados),
        2,
    )
    valor_pago_preservado = round(
        sum(float(comanda.valor_pago or 0) for comanda in comandas),
        2,
    )
    for pagamento in pagamentos_pendentes_cancelados:
        pagamento.status = "cancelado"

    itens_ativos = [
        item
        for comanda in comandas
        for item in comanda.itens
        if item.status != "cancelado"
    ]
    total_cancelado = round(sum(float(item.preco_unit or 0) for item in itens_ativos), 2)
    fechado_em = datetime.datetime.now(datetime.timezone.utc)

    for item in itens_ativos:
        item.status = "cancelado"
        item.cancelado_por = current_user.id
    estornar_estoque_dos_itens(db, itens_ativos, usuario_id=current_user.id)
    for comanda in comandas:
        comanda.fechada = True
        comanda.fechado_em = fechado_em
        comanda.status_comanda = None

    db.add(ActivityLog(
        restaurante_id=rest_id,
        garcom_id=current_user.id,
        action="CANCEL_TABLE_CONSUMPTION",
        details=(
            f"Mesa {mesa_id}: {len(comandas)} comanda(s), {len(itens_ativos)} "
            f"item(ns), total R$ {total_cancelado:.2f}; "
            f"{len(pagamentos_manuais_preservados)} pagamento(s) manual(is) preservado(s), "
            f"R$ {valor_pagamentos_preservados:.2f}; valor já recebido preservado "
            f"R$ {valor_pago_preservado:.2f}; "
            f"{len(pagamentos_pendentes_cancelados)} pagamento(s) pendente(s) cancelado(s). "
            f"Motivo: {motivo}"
        ),
    ))
    db.commit()

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "MESA_ATUALIZADA",
            "data": {"mesa_id": mesa_id, "status": "livre", "comanda_id": None},
        },
        rest_id,
    )
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rest_id)
    if pagamentos_manuais or valor_pago_preservado > 0:
        background_tasks.add_task(
            manager.broadcast,
            {
                "event": "cash_updated",
                "detail": {
                    "type": "cancelamento_mesa_com_pagamento_manual_preservado",
                    "mesa_id": mesa_id,
                    "pagamentos_preservados": len(pagamentos_manuais_preservados),
                    "valor_preservado": valor_pagamentos_preservados,
                    "pagamentos_pendentes_cancelados": len(pagamentos_pendentes_cancelados),
                },
            },
            rest_id,
        )
    return {
        "status": "cancelado",
        "mesa_id": mesa_id,
        "comandas_canceladas": len(comandas),
        "itens_cancelados": len(itens_ativos),
        "total_cancelado": total_cancelado,
        "pagamentos_manuais_preservados": len(pagamentos_manuais_preservados),
        "valor_pagamentos_preservados": valor_pagamentos_preservados,
        "valor_pago_preservado": valor_pago_preservado,
        "pagamentos_pendentes_cancelados": len(pagamentos_pendentes_cancelados),
    }


@router.post("/{mesa_id}/cancelar-itens")
def cancelar_itens_mesa(
    mesa_id: int,
    payload: CancelarItensMesaRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("comandas:forcar_fechamento")),
):
    """Cancela somente os itens representados por um card do Caixa.

    Esta rota deliberadamente não recebe apenas a mesa como escopo. Os IDs dos
    itens são obrigatórios para impedir que uma ação em um pedido apague o
    restante do consumo da mesa.
    """
    rest_id = require_tenant_id()
    motivo = " ".join(payload.motivo.split())
    item_ids = list(dict.fromkeys(item_id.strip() for item_id in payload.item_ids if item_id.strip()))
    if len(motivo) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe um motivo válido com pelo menos 3 caracteres.",
        )
    if not item_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe ao menos um item do pedido a cancelar.",
        )

    itens = (
        db.query(Item)
        .join(Comanda, Comanda.id == Item.comanda_id)
        .filter(
            Item.restaurante_id == rest_id,
            Item.id.in_(item_ids),
            Comanda.restaurante_id == rest_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
        )
        .with_for_update()
        .all()
    )
    if len(itens) != len(item_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O pedido mudou ou contém itens que não pertencem mais a esta mesa. Atualize a tela.",
        )

    itens_ativos = [item for item in itens if item.status != "cancelado"]
    if not itens_ativos:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Os itens deste pedido já foram cancelados.",
        )
    if any(item.pago for item in itens_ativos):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Há item pago neste pedido. Estorne o recebimento antes de cancelar.",
        )

    comanda_ids = list({item.comanda_id for item in itens_ativos})
    comandas = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rest_id,
            Comanda.id.in_(comanda_ids),
            Comanda.fechada == False,
        )
        .with_for_update()
        .all()
    )
    pagamento_existente = db.query(Pagamento.id).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.comanda_id.in_(comanda_ids),
        or_(Pagamento.status.is_(None), Pagamento.status != "cancelado"),
    ).first()
    if pagamento_existente or any(float(comanda.valor_pago or 0) > 0 for comanda in comandas):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Há pagamento registrado neste pedido. Cancele ou estorne o recebimento antes de continuar.",
        )

    total_cancelado = round(sum(float(item.preco_unit or 0) for item in itens_ativos), 2)
    for item in itens_ativos:
        item.status = "cancelado"
        item.cancelado_por = current_user.id
    estornar_estoque_dos_itens(db, itens_ativos, usuario_id=current_user.id)

    fechado_em = datetime.datetime.now(datetime.timezone.utc)
    comandas_fechadas = 0
    for comanda in comandas:
        if all(item.status == "cancelado" for item in comanda.itens):
            comanda.fechada = True
            comanda.fechado_em = fechado_em
            comanda.status_comanda = None
            comandas_fechadas += 1

    mesa_ainda_ocupada = db.query(Comanda.id).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.mesa_id == mesa_id,
        Comanda.fechada == False,
        ~Comanda.id.in_(comanda_ids),
    ).first() is not None or any(not comanda.fechada for comanda in comandas)

    db.add(ActivityLog(
        restaurante_id=rest_id,
        garcom_id=current_user.id,
        action="CANCEL_CASHIER_ORDER_SCOPE",
        details=(
            f"Mesa {mesa_id}: card com {len(itens_ativos)} item(ns), "
            f"total R$ {total_cancelado:.2f}. Motivo: {motivo}"
        ),
    ))
    db.commit()

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "MESA_ATUALIZADA",
            "data": {
                "mesa_id": mesa_id,
                "status": "ocupada" if mesa_ainda_ocupada else "livre",
                "comanda_id": None,
            },
        },
        rest_id,
    )
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rest_id)
    return {
        "status": "cancelado",
        "mesa_id": mesa_id,
        "itens_cancelados": len(itens_ativos),
        "comandas_fechadas": comandas_fechadas,
        "total_cancelado": total_cancelado,
        "mesa_liberada": not mesa_ainda_ocupada,
    }


# ----------------- OBSERVATIONS ENDPOINTS -----------------
@router.get("/observacoes/todas", response_model=List[ObservacaoPredefinidaResponse])
def get_todas_observacoes(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna a lista completa de observações predefinidas do salão."""
    rest_id = require_tenant_id()
    return db.query(ObservacaoPredefinida).filter(
        ObservacaoPredefinida.restaurante_id == rest_id
    ).all()

@router.get("/observacoes/categoria/{categoria_id}", response_model=List[ObservacaoPredefinidaResponse])
def get_observacoes_por_categoria(categoria_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Retorna as observações predefinidas filtradas por uma categoria de prato.
    Ex: Categoria 'Hambúrgueres Bovinos' retorna ['Sem Cheddar', 'Sem cebola'].
    """
    rest_id = require_tenant_id()
    return db.query(ObservacaoPredefinida).filter(
        ObservacaoPredefinida.restaurante_id == rest_id,
        ObservacaoPredefinida.categoria_id == categoria_id,
    ).all()
