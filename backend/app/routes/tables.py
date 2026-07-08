from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models import Mesa, ObservacaoPredefinida, Comanda, Item, Usuario
from ..schemas import MesaResponse, MesaUpdate, MesaCreate, ObservacaoPredefinidaResponse
from ..security import get_current_garcom_optional
from ..websocket_manager import manager

router = APIRouter(
    prefix="/mesas",
    tags=["Mesas e Observações"]
)

# ----------------- TABLES ENDPOINTS -----------------
@router.get("/", response_model=List[MesaResponse])
def get_mesas(db: Session = Depends(get_db)):
    """Retorna todas as mesas do salão com suas respectivas capacidades e nomes."""
    return db.query(Mesa).order_by(Mesa.id).all()

@router.get("/{mesa_id}", response_model=MesaResponse)
def get_mesa(mesa_id: int, db: Session = Depends(get_db)):
    """Busca os detalhes de uma mesa específica pelo ID."""
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
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
    db: Session = Depends(get_db)
):
    """Permite alterar a capacidade ou o nome personalizado da mesa."""
    db_mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
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
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return db_mesa

@router.post("/", response_model=MesaResponse, status_code=status.HTTP_201_CREATED)
def create_mesa(
    mesa_in: MesaCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Cria uma nova mesa dinamicamente no salão."""
    existing = db.query(Mesa).filter(Mesa.id == mesa_in.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mesa com número {mesa_in.id} já existe."
        )
    nova_mesa = Mesa(
        id=mesa_in.id,
        capacidade=mesa_in.capacidade,
        nome=mesa_in.nome
    )
    db.add(nova_mesa)
    db.commit()
    db.refresh(nova_mesa)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return nova_mesa

@router.delete("/{mesa_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mesa(
    mesa_id: int, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Remove uma mesa do salão se ela não tiver nenhuma comanda ativa aberta."""
    mesa = db.query(Mesa).filter(Mesa.id == mesa_id).first()
    if not mesa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mesa não encontrada"
        )
    comanda_ativa = db.query(Comanda).filter(Comanda.mesa_id == mesa_id, Comanda.fechada == False).first()
    if comanda_ativa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível excluir uma mesa com comandas abertas."
        )
    db.delete(mesa)
    db.commit()
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return


# ----------------- OBSERVATIONS ENDPOINTS -----------------
@router.get("/observacoes/todas", response_model=List[ObservacaoPredefinidaResponse])
def get_todas_observacoes(db: Session = Depends(get_db)):
    """Retorna a lista completa de observações predefinidas do salão."""
    return db.query(ObservacaoPredefinida).all()

@router.get("/observacoes/categoria/{categoria_id}", response_model=List[ObservacaoPredefinidaResponse])
def get_observacoes_por_categoria(categoria_id: str, db: Session = Depends(get_db)):
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
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
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
                "produto": {
                    "nome": item.produto.nome
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
        
        from ..models import ConfiguracaoRestaurante
        config = db.query(ConfiguracaoRestaurante).first()
        taxa_servico_ativa = config.taxa_servico_ativa if config else True
        taxa_servico_padrao = config.taxa_servico_padrao if config else 10.0
        
        receipt_text = printer_service.generate_receipt(
            num_pedido=num_pedido,
            tipo=tipo,
            mesa_id=mesa_id,
            garcom_nome=garcom_nome,
            comandas_details=comandas_details,
            print_header=print_header,
            print_footer=print_footer,
            taxa_servico_ativa=taxa_servico_ativa,
            taxa_servico_padrao=taxa_servico_padrao
        )
        
        printer_service.send_to_printer("recibo", receipt_text)
    except Exception as print_err:
        raise HTTPException(
            status_code=500,
            detail=f"Erro na impressora: {print_err}"
        )
        
    return {"status": "success", "detail": "Impressão do recibo enviada com sucesso"}
