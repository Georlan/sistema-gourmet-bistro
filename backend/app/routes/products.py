from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import Produto, Categoria
from ..schemas import ProdutoResponse, ProdutoCreate, ProdutoUpdate, CategoriaResponse

router = APIRouter(
    prefix="/produtos",
    tags=["Produtos e Categorias"]
)

# ----------------- CATEGORIES ENDPOINTS -----------------
@router.get("/categorias", response_model=List[CategoriaResponse])
def get_categorias(db: Session = Depends(get_db)):
    """Retorna todas as categorias de produtos cadastradas no cardápio."""
    return db.query(Categoria).all()


# ----------------- PRODUCTS ENDPOINTS -----------------
@router.get("/", response_model=List[ProdutoResponse])
def get_produtos(db: Session = Depends(get_db)):
    """Retorna todos os produtos cadastrados no cardápio."""
    return db.query(Produto).all()

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
def update_produto(produto_id: str, update_data: ProdutoUpdate, db: Session = Depends(get_db)):
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
