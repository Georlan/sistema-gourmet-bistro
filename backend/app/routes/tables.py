import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db, current_restaurante_id, require_tenant_id
from ..models import (
    Mesa,
    ObservacaoPredefinida,
    Comanda,
    Item,
    Usuario,
    Pagamento,
    ActivityLog,
)
from ..schemas import (
    MesaResponse,
    MesaUpdate,
    MesaCreate,
    CancelarConsumoMesaRequest,
    CancelarItensMesaRequest,
    ObservacaoPredefinidaResponse,
)
from ..security import get_current_garcom_optional, get_current_user, require_permission
from ..services.printing import PrintingRequestError, enqueue_table_receipt
from ..services.inventory import estornar_estoque_dos_itens
from ..waiter_permissions import require_waiter_permission
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
    """Cancela todo o consumo aberto de uma mesa sem gerar recebimento.

    O histórico é preservado: itens são marcados como cancelados e comandas são
    fechadas. Pagamentos existentes bloqueiam a operação para evitar apagar um
    consumo que já produziu efeito financeiro.
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
    pagamento_existente = db.query(Pagamento.id).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.comanda_id.in_(comanda_ids),
        or_(Pagamento.status.is_(None), Pagamento.status != "cancelado"),
    ).first()
    valor_pago_legado = any(float(comanda.valor_pago or 0) > 0 for comanda in comandas)
    if pagamento_existente or valor_pago_legado:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Há pagamento registrado nesta mesa. Cancele ou estorne o "
                "recebimento antes de liberar a mesa sem contabilizar o consumo."
            ),
        )

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
            f"item(ns), total R$ {total_cancelado:.2f}. Motivo: {motivo}"
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
    return {
        "status": "cancelado",
        "mesa_id": mesa_id,
        "comandas_canceladas": len(comandas),
        "itens_cancelados": len(itens_ativos),
        "total_cancelado": total_cancelado,
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


@router.post("/{mesa_id}/imprimir-recibo", status_code=status.HTTP_200_OK)
def imprimir_recibo_mesa(
    mesa_id: int,
    print_header: Optional[str] = None,
    print_footer: Optional[str] = None,
    apenas_valores: bool = False,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """Enfileira a via canônica de uma mesa aberta.

    ``apenas_valores=false`` é o Extrato Completo. ``true`` é o Fechamento de
    mesa pré-pagamento. Ambos usam o mesmo snapshot e o mesmo formatter usados
    pelas impressões automáticas e reimpressões de consumo no local.
    """
    require_waiter_permission(db, current_garcom, "perm_garcom_print")
    rest_id = require_tenant_id()
    try:
        job = enqueue_table_receipt(
            db,
            rest_id,
            mesa_id,
            apenas_valores=apenas_valores,
            source_type="mesa",
            source_id=str(mesa_id),
            print_header=print_header,
            print_footer=print_footer,
            printed_by=current_garcom.nome,
        )
        db.commit()
    except PrintingRequestError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao enfileirar impressão do recibo.",
        ) from exc

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A impressão física não está disponível no plano atual.",
        )

    return {
        "status": "success",
        "detail": "Impressão do recibo enviada com sucesso para a fila de impressão",
        "job_id": job.id,
    }
