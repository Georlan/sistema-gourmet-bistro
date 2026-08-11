from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional, Union
from ..database import get_db, require_tenant_id
from ..models import Produto, Categoria, ObservacaoPredefinida, Usuario
from ..security import get_current_user, require_permission
from ..schemas import ProdutoResponse, ProdutoCreate, ProdutoUpdate, CategoriaResponse
from ..websocket_manager import manager
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
import re
import unicodedata

router = APIRouter(
    prefix="/produtos",
    tags=["Produtos e Categorias"]
)

def notify_catalog_update(
    background_tasks: BackgroundTasks,
    message: str,
    restaurante_id: int,
) -> None:
    """Publica um único evento canônico para caixa, garçom e cardápio digital."""
    background_tasks.add_task(
        manager.broadcast,
        {"event": "catalog_updated", "message": message},
        restaurante_id,
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
    model_config = ConfigDict(from_attributes=True)

class CatalogoResponse(BaseModel):
    categorias: List[CategoriaResponse]
    produtos: List[ProdutoResponse]


CATEGORY_DISPLAY_ORDER = [
    "Pizzas Tradicionais", "Pizzas Especiais", "Hambúrgueres Bovinos",
    "Hambúrgueres de Frango", "Hambúrgueres Suínos", "Baguetes",
    "Pastéis Tradicionais", "Pastelões Especiais", "Pastéis Doces",
    "Petiscos", "Combos Promocionais", "Sucos", "Refrigerantes e Águas",
    "Bebidas & Vinhos", "Cervejas", "Bebidas Quentes", "Sobremesas",
]

def ordered_categories(categories: List[Categoria]) -> List[Categoria]:
    positions = {name: index for index, name in enumerate(CATEGORY_DISPLAY_ORDER)}
    return sorted(
        categories,
        key=lambda category: (
            positions.get(category.nome, len(positions)),
            category.nome.casefold(),
        ),
    )


# ─── CATEGORIES ENDPOINTS ─────────────────────────────────────────────────────
@router.get("/categorias", response_model=List[CategoriaResponse])
def get_categorias(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna todas as categorias de produtos cadastradas no cardápio do restaurante ativo."""
    rest_id = require_tenant_id()
    categorias = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()
    return ordered_categories(categorias)

@router.post("/categorias", response_model=CategoriaResponse, status_code=status.HTTP_201_CREATED)
def create_categoria(
    data: CategoriaCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Cria uma nova categoria (setup wizard interno)."""
    rest_id = require_tenant_id()
    if db.query(Categoria).filter_by(restaurante_id=rest_id, id=data.id).first():
        raise HTTPException(status_code=400, detail="ID de categoria já existe.")
    cat = Categoria(id=data.id, nome=data.nome, destino_impressao=data.destino_impressao)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    notify_catalog_update(background_tasks, "Categoria criada", require_tenant_id())
    return cat

@router.put("/categorias/{categoria_id}", response_model=CategoriaResponse)
def update_categoria(
    categoria_id: str,
    data: CategoriaUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Atualiza nome e/ou destino de impressão de uma categoria."""
    rest_id = require_tenant_id()
    cat = db.query(Categoria).filter_by(restaurante_id=rest_id, id=categoria_id).first()
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
    notify_catalog_update(background_tasks, "Categoria atualizada", require_tenant_id())
    return cat

@router.delete("/categorias/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_categoria(
    categoria_id: str, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Remove uma categoria (só se não tiver produtos vinculados)."""
    rest_id = require_tenant_id()
    cat = db.query(Categoria).filter_by(restaurante_id=rest_id, id=categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    if cat.produtos:
        raise HTTPException(status_code=400, detail=f"Categoria tem {len(cat.produtos)} produto(s) vinculado(s). Remova-os primeiro.")
    db.delete(cat)
    db.commit()
    notify_catalog_update(background_tasks, "Categoria excluída", require_tenant_id())
    return


# ─── PREDEFINED OBSERVATIONS ENDPOINTS ───────────────────────────────────────
@router.get("/observacoes", response_model=List[ObservacaoResponse])
def get_observacoes(categoria_id: Optional[str] = None, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Lista observações predefinidas. Filtra por categoria_id se fornecido."""
    rest_id = require_tenant_id()
    q = db.query(ObservacaoPredefinida).filter(ObservacaoPredefinida.restaurante_id == rest_id)
    if categoria_id:
        q = q.filter_by(categoria_id=categoria_id)
    return q.all()

@router.post("/observacoes", response_model=ObservacaoResponse, status_code=status.HTTP_201_CREATED)
def create_observacao(
    data: ObservacaoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Adiciona uma nova observação predefinida a uma categoria."""
    rest_id = require_tenant_id()
    if not db.query(Categoria).filter_by(restaurante_id=rest_id, id=data.categoria_id).first():
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    obs = ObservacaoPredefinida(categoria_id=data.categoria_id, texto=data.texto)
    db.add(obs)
    db.commit()
    db.refresh(obs)
    return obs

@router.delete("/observacoes/{obs_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_observacao(
    obs_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Remove uma observação predefinida pelo ID."""
    rest_id = require_tenant_id()
    obs = db.query(ObservacaoPredefinida).filter_by(restaurante_id=rest_id, id=obs_id).first()
    if not obs:
        raise HTTPException(status_code=404, detail="Observação não encontrada.")
    db.delete(obs)
    db.commit()
    return


# ─── PRODUCTS ENDPOINTS ───────────────────────────────────────────────────────



# ----------------- PRODUCTS ENDPOINTS -----------------
@router.get("/", response_model=List[ProdutoResponse])
def get_produtos(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna todos os produtos cadastrados no cardápio do restaurante ativo, ordenados por ID dentro de cada categoria."""
    rest_id = require_tenant_id()
    return (
        db.query(Produto)
        .options(joinedload(Produto.categoria))
        .filter(Produto.restaurante_id == rest_id)
        .order_by(Produto.id)
        .all()
    )

@router.get("/catalogo", response_model=CatalogoResponse)
def get_catalogo(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Snapshot único do catálogo usado pelo caixa e pelo app do garçom."""
    del current_user
    rest_id = require_tenant_id()
    categorias = ordered_categories(
        db.query(Categoria)
        .filter(Categoria.restaurante_id == rest_id)
        .all()
    )
    produtos = (
        db.query(Produto)
        .options(joinedload(Produto.categoria))
        .filter(Produto.restaurante_id == rest_id)
        .order_by(Produto.id)
        .all()
    )
    return {"categorias": categorias, "produtos": produtos}

@router.get("/{produto_id}", response_model=ProdutoResponse)
def get_produto(produto_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Busca um produto específico no cardápio do restaurante ativo pelo ID."""
    rest_id = require_tenant_id()
    produto = db.query(Produto).filter(Produto.id == produto_id, Produto.restaurante_id == rest_id).first()
    if not produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
    return produto

@router.post("/", response_model=ProdutoResponse, status_code=status.HTTP_201_CREATED)
def create_produto(
    produto_data: ProdutoCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Cadastra um novo produto no cardápio."""
    rest_id = require_tenant_id()
    # Check if category exists
    categoria = db.query(Categoria).filter(
        Categoria.restaurante_id == rest_id,
        Categoria.id == produto_data.categoria_id,
    ).first()
    if not categoria:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A categoria informada não existe"
        )
        
    # Check if product ID already exists
    existente = db.query(Produto).filter(
        Produto.restaurante_id == rest_id,
        Produto.id == produto_data.id,
    ).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um produto cadastrado com este ID"
        )
        
    novo_produto = Produto(**produto_data.model_dump())
    db.add(novo_produto)
    db.commit()
    db.refresh(novo_produto)
    notify_catalog_update(background_tasks, "Produto criado", require_tenant_id())
    return novo_produto

@router.put("/{produto_id}", response_model=ProdutoResponse)
def update_produto(
    produto_id: str, 
    update_data: ProdutoUpdate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Atualiza as informações de um produto, incluindo seu preço ou status de ativação."""
    rest_id = require_tenant_id()
    db_produto = db.query(Produto).filter(
        Produto.restaurante_id == rest_id,
        Produto.id == produto_id,
    ).first()
    if not db_produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
        
    data = update_data.model_dump(exclude_unset=True)
    
    # Check category if it is being updated
    if "categoria_id" in data:
        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == rest_id,
            Categoria.id == data["categoria_id"],
        ).first()
        if not categoria:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A categoria informada não existe"
            )
            
    for key, value in data.items():
        setattr(db_produto, key, value)
        
    db.commit()
    db.refresh(db_produto)
    notify_catalog_update(background_tasks, "Produto atualizado", require_tenant_id())
    return db_produto

@router.delete("/{produto_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_produto(
    produto_id: str, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """Remove um produto dos canais de venda preservando o histórico."""
    rest_id = require_tenant_id()
    db_produto = db.query(Produto).filter(
        Produto.restaurante_id == rest_id,
        Produto.id == produto_id,
    ).first()
    if not db_produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
    # Exclusão lógica: o item some imediatamente dos três canais sem quebrar
    # comandas antigas que preservam a FK e o preço praticado na venda.
    db_produto.ativo = False
    db.commit()
    notify_catalog_update(background_tasks, "Produto removido do cardápio", require_tenant_id())
    return

class ProdutoImportItem(BaseModel):
    id: str
    nome: str
    preco: float
    categoria_id: str
    descricao: Optional[str] = None
    imagem: Optional[str] = None
    imagens_galeria: Optional[List[str]] = None
    ativo: Optional[bool] = True

class CategoriaImportItem(BaseModel):
    id: Optional[str] = None
    nome: str
    destino_impressao: str = "COZINHA"

class CardapioImportPayload(BaseModel):
    categories: Optional[List[Union[str, CategoriaImportItem]]] = Field(
        default=None,
        validation_alias=AliasChoices("categories", "categorias"),
    )
    products: Optional[List[ProdutoImportItem]] = Field(
        default=None,
        validation_alias=AliasChoices("products", "produtos"),
    )

def category_id_from_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("utf-8").lower()
    slug = re.sub(r"[^a-z0-9-]+", "-", normalized).strip("-")
    return f"cat-{slug}"

@router.post("/importar", response_model=List[ProdutoResponse])
def importar_cardapio(
    payload: Union[List[ProdutoImportItem], CardapioImportPayload],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    """
    Importa uma lista de produtos sobrescrevendo o cardápio atual.
    Suporta lista direta ou o formato composto {categories, products},
    também aceitando as chaves em português {categorias, produtos}.
    Produtos antigos que não estão no novo cardápio serão inativados (ativo = False).
    O commit é único e depois um evento atualiza caixa, garçom e cardápio digital.
    """
    rest_id = require_tenant_id()

    if isinstance(payload, CardapioImportPayload):
        produtos_data = payload.products or []
        # Opcionalmente podemos criar/garantir categorias da lista de categorias se informadas
        if payload.categories:
            for category_data in payload.categories:
                if isinstance(category_data, str):
                    cat_nome = category_data
                    id_cat = category_id_from_name(category_data)
                    destino = "NENHUM" if any(term in id_cat for term in ("suco", "refri", "cerveja", "bebida")) else "COZINHA"
                else:
                    cat_nome = category_data.nome
                    id_cat = category_data.id or category_id_from_name(category_data.nome)
                    destino = category_data.destino_impressao

                if destino not in ("COZINHA", "BAR", "NENHUM"):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Destino de impressão inválido na categoria {cat_nome}.",
                    )
                
                cat = db.query(Categoria).filter(
                    Categoria.restaurante_id == rest_id,
                    Categoria.id == id_cat,
                ).first()
                if not cat:
                    cat = Categoria(id=id_cat, nome=cat_nome, destino_impressao=destino)
                    db.add(cat)
                else:
                    cat.nome = cat_nome
                    cat.destino_impressao = destino
            db.flush()
    else:
        produtos_data = payload
        
    # 1. Inativar temporariamente todos os produtos atuais no banco (com isolamento de tenant)
    db.query(Produto).filter(Produto.restaurante_id == rest_id).update({Produto.ativo: False})
    
    imported_products = []
    
    # 2. Processar a lista importada (Upsert)
    for item in produtos_data:
        # Garantir categoria
        cat_id = item.categoria_id
        cat = db.query(Categoria).filter(
            Categoria.restaurante_id == rest_id,
            Categoria.id == cat_id,
        ).first()
        if not cat:
            nome_cat = cat_id.replace("cat-", "").replace("-", " ").replace("_", " ").title()
            destino = "COZINHA"
            if cat_id in ["cat-refri", "cat-cervejas"]:
                destino = "NENHUM"
            cat = Categoria(id=cat_id, nome=nome_cat, destino_impressao=destino)
            db.add(cat)
            db.flush()
            
        existente = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.id == item.id,
        ).first()
        if existente:
            existente.nome = item.nome
            existente.preco = item.preco
            existente.categoria_id = item.categoria_id
            if item.descricao is not None:
                existente.descricao = item.descricao
            if item.imagem is not None:
                existente.imagem = item.imagem
            if item.imagens_galeria is not None:
                existente.imagens_galeria = item.imagens_galeria
            # Ativar o produto novamente
            existente.ativo = item.ativo if item.ativo is not None else True
            imported_products.append(existente)
        else:
            novo = Produto(
                id=item.id,
                nome=item.nome,
                preco=item.preco,
                categoria_id=item.categoria_id,
                descricao=item.descricao or "",
                imagem=item.imagem or "",
                imagens_galeria=item.imagens_galeria or [],
                ativo=item.ativo if item.ativo is not None else True
            )
            db.add(novo)
            imported_products.append(novo)

    db.flush()

    # 3. Limpeza preventiva de categorias órfãs (sem produtos ativos e sem observações)
    # (Nenhum produto inativo é deletado do banco fisicamente, conforme regras)
    categorias = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()
    for c in categorias:
        produtos_ativos_cat = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.categoria_id == c.id,
            Produto.ativo.is_(True),
        ).first()
        if not produtos_ativos_cat:
            obs_vinculo = db.query(ObservacaoPredefinida).filter(
                ObservacaoPredefinida.restaurante_id == rest_id,
                ObservacaoPredefinida.categoria_id == c.id,
            ).first()
            if not obs_vinculo:
                # Garantir que não existam produtos inativos remanescentes vinculados
                prod_inativo = db.query(Produto).filter(
                    Produto.restaurante_id == rest_id,
                    Produto.categoria_id == c.id,
                ).first()
                if not prod_inativo:
                    db.delete(c)

    # 4. Um único db.commit() no final de toda a operação de import
    db.commit()

    # 5. Refresh nos produtos importados para carregar relações e dados do banco pós-commit
    for prod in imported_products:
        db.refresh(prod)

    # 6. Notificar os três canais uma única vez após o commit atômico.
    notify_catalog_update(background_tasks, "Cardápio importado", rest_id)
    
    return imported_products
