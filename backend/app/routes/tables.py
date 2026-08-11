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
    ObservacaoPredefinidaResponse,
)
from ..security import get_current_garcom_optional, get_current_user, require_permission
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
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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


# ----------------- OBSERVATIONS ENDPOINTS -----------------
@router.get("/observacoes/todas", response_model=List[ObservacaoPredefinidaResponse])
def get_todas_observacoes(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna a lista completa de observações predefinidas do salão."""
    return db.query(ObservacaoPredefinida).all()

@router.get("/observacoes/categoria/{categoria_id}", response_model=List[ObservacaoPredefinidaResponse])
def get_observacoes_por_categoria(categoria_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Retorna as observações predefinidas filtradas por uma categoria de prato.
    Ex: Categoria 'Hambúrgueres Bovinos' retorna ['Sem Cheddar', 'Sem cebola'].
    """
    return db.query(ObservacaoPredefinida).filter(ObservacaoPredefinida.categoria_id == categoria_id).all()


@router.post("/{mesa_id}/imprimir-recibo", status_code=status.HTTP_200_OK)
def imprimir_recibo_mesa(
    mesa_id: int,
    print_header: Optional[str] = None,
    print_footer: Optional[str] = None,
    apenas_valores: bool = False,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """
    Imprime o recibo de consumo de todas as comandas abertas da mesa.
    Aceita qualquer operador autenticado (garçom ou caixa).
    """
    # Allow any authenticated user OR allow unauthenticated (LAN-only access is the security boundary)
        
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(
            status_code=404,
            detail="Mesa não encontrada"
        )
        
    # Gathers open comandas for this table
    comandas = db.query(Comanda).filter(
        Comanda.mesa_id == mesa_id,
        Comanda.fechada == False
    ).all()
    
    if not comandas:
        raise HTTPException(
            status_code=400,
            detail="Não há comandas abertas nesta mesa"
        )
        
    # Check if there are active items to print
    has_active_items = False
    comandas_details = []
    
    for comanda in comandas:
        comanda_data = {
            "id": comanda.id,
            "identificador": comanda.identificador,
            "itens": []
        }
        for item in comanda.itens:
            if item.status != "cancelado":
                has_active_items = True
            comanda_data["itens"].append({
                "id": item.id,
                "preco_unit": item.preco_unit,
                "status": item.status,
                "cliente_nome": item.cliente_nome,
                "codigo": item.produto.id,
                "descricao": item.produto.descricao,
                "observacao": item.observacao,
                "produto": {
                    "id": item.produto.id,
                    "nome": item.produto.nome,
                    "descricao": item.produto.descricao,
                }
            })
        comandas_details.append(comanda_data)
        
    if not has_active_items:
        raise HTTPException(
            status_code=400,
            detail="Não há itens ativos para imprimir nesta mesa"
        )
        
    try:
        from ..printer_service import printer_service
        
        # Use info from the first comanda
        first_comanda = comandas[0]
        num_pedido = first_comanda.numero_pedido
        tipo = first_comanda.tipo
        garcom_nome = first_comanda.criada_por.nome if first_comanda.criada_por else "Garçom"
        opened_at = min(
            (
                comanda.criado_em
                for comanda in comandas
                if comanda.criado_em is not None
            ),
            default=None,
        )
        
        from ..models import ConfiguracaoRestaurante
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == first_comanda.restaurante_id
        ).first()
        taxa_servico_ativa = config.taxa_servico_ativa if config else True
        taxa_servico_padrao = config.taxa_servico_padrao if config else 10.0
        configured_name = (
            print_header
            or (config.impressao_nome_restaurante if config else None)
            or (
                config.restaurante.nome
                if config and config.restaurante
                else None
            )
            or "Kôma Gourmet Bistrô"
        )
        configured_footer = (
            print_footer
            or (config.impressao_mensagem_rodape if config else None)
        )
        
        receipt_text = printer_service.generate_receipt(
            num_pedido=num_pedido,
            tipo=tipo,
            mesa_id=mesa_id,
            garcom_nome=garcom_nome,
            comandas_details=comandas_details,
            opened_at=opened_at,
            print_header=configured_name,
            print_footer=configured_footer,
            taxa_servico_ativa=taxa_servico_ativa,
            taxa_servico_padrao=taxa_servico_padrao,
            apenas_valores=apenas_valores,
            restaurant_name_position=(
                config.impressao_nome_posicao if config else "cabecalho"
            ),
        )
        
        from ..models import PrintJob
        rest_id = require_tenant_id()
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
        ikey = f"fechamento:mesa:{mesa_id}:{ts}"
        
        job = PrintJob(
            restaurante_id=rest_id,
            document_type="fechamento",
            destination="FECHAMENTO",
            source_type="comanda",
            source_id=str(mesa_id),
            payload_text=receipt_text.replace("\x00", "\\x00"),
            status="pending",
            idempotency_key=ikey
        )
        db.add(job)
        db.commit()
        print(f"[PRINT JOB ENQUEUED] Job de fechamento ID {job.id} enfileirado para o Kôma Agent!")
    except Exception as print_err:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao enfileirar impressão do recibo: {print_err}"
        )
        
    return {"status": "success", "detail": "Impressão do recibo enviada com sucesso para a fila de impressão"}
