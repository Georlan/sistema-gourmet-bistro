from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from ..database import get_db
from ..models import Produto, Categoria, ObservacaoPredefinida
from ..schemas import ProdutoResponse, ProdutoCreate, ProdutoUpdate, CategoriaResponse
from ..websocket_manager import manager
from pydantic import BaseModel

router = APIRouter(
    prefix="/produtos",
    tags=["Produtos e Categorias"]
)

# ─── SCHEMAS (inline para evitar circular imports) ────────────────────────────
class CategoriaUpdate(BaseModel):
    nome: Optional[str] = None
    destino_impressao: Optional[str] = None  # "COZINHA" | "BAR" | "NENHUM"

class CategoriaCreate(BaseModel):
    id: str
    nome: str
    destino_impressao: str = "COZINHA"

class ObservacaoCreate(BaseModel):
    categoria_id: str
    texto: str

class ObservacaoResponse(BaseModel):
    id: int
    categoria_id: str
    texto: str
    class Config:
        from_attributes = True


# ─── CATEGORIES ENDPOINTS ─────────────────────────────────────────────────────
@router.get("/categorias", response_model=List[CategoriaResponse])
def get_categorias(db: Session = Depends(get_db)):
    """Retorna todas as categorias de produtos cadastradas no cardápio."""
    categorias = db.query(Categoria).all()
    order_list = [
        "Hambúrgueres Bovinos",
        "Hambúrgueres de Frango",
        "Hambúrgueres Suínos",
        "Baguetes",
        "Pastéis Tradicionais",
        "Pastelões Especiais",
        "Pastéis Doces",
        "Petiscos",
        "Combos Promocionais",
        "Sucos",
        "Refrigerantes e Águas",
        "Cervejas",
        "Bebidas Quentes"
    ]
    return sorted(
        categorias,
        key=lambda c: order_list.index(c.nome) if c.nome in order_list else len(order_list)
    )

@router.post("/categorias", response_model=CategoriaResponse, status_code=status.HTTP_201_CREATED)
def create_categoria(data: CategoriaCreate, db: Session = Depends(get_db)):
    """Cria uma nova categoria (setup wizard interno)."""
    if db.query(Categoria).filter_by(id=data.id).first():
        raise HTTPException(status_code=400, detail="ID de categoria já existe.")
    cat = Categoria(id=data.id, nome=data.nome, destino_impressao=data.destino_impressao)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat

@router.put("/categorias/{categoria_id}", response_model=CategoriaResponse)
def update_categoria(
    categoria_id: str,
    data: CategoriaUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Atualiza nome e/ou destino de impressão de uma categoria."""
    cat = db.query(Categoria).filter_by(id=categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    if data.nome is not None:
        cat.nome = data.nome
    if data.destino_impressao is not None:
        if data.destino_impressao not in ("COZINHA", "BAR", "NENHUM"):
            raise HTTPException(status_code=400, detail="destino_impressao deve ser COZINHA, BAR ou NENHUM.")
        cat.destino_impressao = data.destino_impressao
    db.commit()
    db.refresh(cat)
    background_tasks.add_task(manager.broadcast, {"event": "config_updated"})
    return cat

@router.delete("/categorias/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_categoria(categoria_id: str, db: Session = Depends(get_db)):
    """Remove uma categoria (só se não tiver produtos vinculados)."""
    cat = db.query(Categoria).filter_by(id=categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    if cat.produtos:
        raise HTTPException(status_code=400, detail=f"Categoria tem {len(cat.produtos)} produto(s) vinculado(s). Remova-os primeiro.")
    db.delete(cat)
    db.commit()
    return


# ─── PREDEFINED OBSERVATIONS ENDPOINTS ───────────────────────────────────────
@router.get("/observacoes", response_model=List[ObservacaoResponse])
def get_observacoes(categoria_id: Optional[str] = None, db: Session = Depends(get_db)):
    """Lista observações predefinidas. Filtra por categoria_id se fornecido."""
    q = db.query(ObservacaoPredefinida)
    if categoria_id:
        q = q.filter_by(categoria_id=categoria_id)
    return q.all()

@router.post("/observacoes", response_model=ObservacaoResponse, status_code=status.HTTP_201_CREATED)
def create_observacao(data: ObservacaoCreate, db: Session = Depends(get_db)):
    """Adiciona uma nova observação predefinida a uma categoria."""
    if not db.query(Categoria).filter_by(id=data.categoria_id).first():
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    obs = ObservacaoPredefinida(categoria_id=data.categoria_id, texto=data.texto)
    db.add(obs)
    db.commit()
    db.refresh(obs)
    return obs

@router.delete("/observacoes/{obs_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_observacao(obs_id: int, db: Session = Depends(get_db)):
    """Remove uma observação predefinida pelo ID."""
    obs = db.query(ObservacaoPredefinida).filter_by(id=obs_id).first()
    if not obs:
        raise HTTPException(status_code=404, detail="Observação não encontrada.")
    db.delete(obs)
    db.commit()
    return


# ─── PRINT QUEUE STATUS (Admin) ───────────────────────────────────────────────
@router.get("/print-queue/status")
def get_print_queue_status():
    """Retorna status da fila de impressão (jobs pendentes e com falha)."""
    from ..printer_service import printer_service
    return printer_service.get_queue_status()

@router.post("/print-queue/retry")
def retry_print_queue():
    """Tenta reimprimir todos os jobs com falha. Chame quando a impressora voltar."""
    from ..printer_service import printer_service
    result = printer_service.retry_failed_jobs()
    return {
        "status": "ok",
        **result,
        "message": f"{result['success']} de {result['retried']} jobs reimpressos."
    }


# ─── PRODUCTS ENDPOINTS ───────────────────────────────────────────────────────



# ----------------- PRODUCTS ENDPOINTS -----------------
@router.get("/", response_model=List[ProdutoResponse])
def get_produtos(db: Session = Depends(get_db)):
    """Retorna todos os produtos cadastrados no cardápio."""
    return db.query(Produto).options(joinedload(Produto.categoria)).all()

@router.get("/{produto_id}", response_model=ProdutoResponse)
def get_produto(produto_id: str, db: Session = Depends(get_db)):
    """Busca um produto específico no cardápio pelo ID."""
    produto = db.query(Produto).filter(Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
    return produto

@router.post("/", response_model=ProdutoResponse, status_code=status.HTTP_201_CREATED)
def create_produto(produto_data: ProdutoCreate, db: Session = Depends(get_db)):
    """Cadastra um novo produto no cardápio."""
    # Check if category exists
    categoria = db.query(Categoria).filter(Categoria.id == produto_data.categoria_id).first()
    if not categoria:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A categoria informada não existe"
        )
        
    # Check if product ID already exists
    existente = db.query(Produto).filter(Produto.id == produto_data.id).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um produto cadastrado com este ID"
        )
        
    novo_produto = Produto(**produto_data.model_dump())
    db.add(novo_produto)
    db.commit()
    db.refresh(novo_produto)
    return novo_produto

@router.put("/{produto_id}", response_model=ProdutoResponse)
def update_produto(
    produto_id: str, 
    update_data: ProdutoUpdate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Atualiza as informações de um produto, incluindo seu preço ou status de ativação."""
    db_produto = db.query(Produto).filter(Produto.id == produto_id).first()
    if not db_produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
        
    data = update_data.model_dump(exclude_unset=True)
    
    # Check category if it is being updated
    if "categoria_id" in data:
        categoria = db.query(Categoria).filter(Categoria.id == data["categoria_id"]).first()
        if not categoria:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A categoria informada não existe"
            )
            
    for key, value in data.items():
        setattr(db_produto, key, value)
        
    db.commit()
    db.refresh(db_produto)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return db_produto

@router.delete("/{produto_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_produto(produto_id: str, db: Session = Depends(get_db)):
    """Remove definitivamente um produto do cardápio."""
    db_produto = db.query(Produto).filter(Produto.id == produto_id).first()
    if not db_produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
    db.delete(db_produto)
    db.commit()
    return
