import os
import json
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional, Union, Dict, Any
from ..database import get_db, current_restaurante_id, require_tenant_id
from ..models import Produto, Categoria, ObservacaoPredefinida, Usuario
from ..security import get_current_user
from ..schemas import ProdutoResponse, ProdutoCreate, ProdutoUpdate, CategoriaResponse
from ..websocket_manager import manager
from pydantic import BaseModel, ConfigDict

router = APIRouter(
    prefix="/produtos",
    tags=["Produtos e Categorias"]
)

def sincronizar_cardapio_json(db: Session):
    """
    Sincroniza os produtos e categorias ativos do banco de dados
    com o arquivo físico 'backend/dump.json'.
    """
    try:
        # Obter todos os produtos ativos
        produtos_ativos = db.query(Produto).filter(Produto.ativo == True).all()
        
        # Obter todas as categorias que possuem pelo menos um produto ativo
        categoria_ids_ativas = {p.categoria_id for p in produtos_ativos}
        categorias_ativas = db.query(Categoria).filter(Categoria.id.in_(categoria_ids_ativas)).all()
        
        # Mapear os nomes das categorias por ID
        cat_nome_map = {c.id: c.nome for c in categorias_ativas}
        
        # Manter a ordem das categorias consistente
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
        
        def get_cat_index(c):
            return order_list.index(c.nome) if c.nome in order_list else len(order_list)
            
        categorias_ativas_ordenadas = sorted(categorias_ativas, key=get_cat_index)
        
        # Formatar a lista de categorias e produtos no formato original do dump
        data = {
            "categories": [c.nome for c in categorias_ativas_ordenadas],
            "products": [
                {
                    "id": p.id,
                    "nome": p.nome,
                    "categoria": cat_nome_map.get(p.categoria_id, p.categoria_id),
                    "preco": float(p.preco),
                    "descricao": p.descricao or "",
                    "imagem": p.imagem or ""
                }
                for p in produtos_ativos
            ]
        }
        
        # Gravar no arquivo backend/dump.json
        filepath = "backend/dump.json"
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print(f"Erro ao sincronizar cardápio JSON: {e}")

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


# ─── CATEGORIES ENDPOINTS ─────────────────────────────────────────────────────
@router.get("/categorias", response_model=List[CategoriaResponse])
def get_categorias(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
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
def create_categoria(
    data: CategoriaCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Cria uma nova categoria (setup wizard interno)."""
    if db.query(Categoria).filter_by(id=data.id).first():
        raise HTTPException(status_code=400, detail="ID de categoria já existe.")
    cat = Categoria(id=data.id, nome=data.nome, destino_impressao=data.destino_impressao)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    sincronizar_cardapio_json(db)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Categoria criada"}, current_user.restaurante_id)
    return cat

@router.put("/categorias/{categoria_id}", response_model=CategoriaResponse)
def update_categoria(
    categoria_id: str,
    data: CategoriaUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
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
    sincronizar_cardapio_json(db)
    background_tasks.add_task(manager.broadcast, {"event": "config_updated"})
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Categoria atualizada"}, current_user.restaurante_id)
    return cat

@router.delete("/categorias/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_categoria(
    categoria_id: str, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Remove uma categoria (só se não tiver produtos vinculados)."""
    cat = db.query(Categoria).filter_by(id=categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    if cat.produtos:
        raise HTTPException(status_code=400, detail=f"Categoria tem {len(cat.produtos)} produto(s) vinculado(s). Remova-os primeiro.")
    db.delete(cat)
    db.commit()
    sincronizar_cardapio_json(db)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Categoria excluída"}, current_user.restaurante_id)
    return


# ─── PREDEFINED OBSERVATIONS ENDPOINTS ───────────────────────────────────────
@router.get("/observacoes", response_model=List[ObservacaoResponse])
def get_observacoes(categoria_id: Optional[str] = None, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Lista observações predefinidas. Filtra por categoria_id se fornecido."""
    q = db.query(ObservacaoPredefinida)
    if categoria_id:
        q = q.filter_by(categoria_id=categoria_id)
    return q.all()

@router.post("/observacoes", response_model=ObservacaoResponse, status_code=status.HTTP_201_CREATED)
def create_observacao(data: ObservacaoCreate, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Adiciona uma nova observação predefinida a uma categoria."""
    if not db.query(Categoria).filter_by(id=data.categoria_id).first():
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    obs = ObservacaoPredefinida(categoria_id=data.categoria_id, texto=data.texto)
    db.add(obs)
    db.commit()
    db.refresh(obs)
    return obs

@router.delete("/observacoes/{obs_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_observacao(obs_id: int, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Remove uma observação predefinida pelo ID."""
    obs = db.query(ObservacaoPredefinida).filter_by(id=obs_id).first()
    if not obs:
        raise HTTPException(status_code=404, detail="Observação não encontrada.")
    db.delete(obs)
    db.commit()
    return


# ─── PRINT QUEUE STATUS (Admin) ───────────────────────────────────────────────
@router.get("/print-queue/status")
def get_print_queue_status(current_user: Usuario = Depends(get_current_user)):
    """Retorna status da fila de impressão (jobs pendentes e com falha)."""
    from ..printer_service import printer_service
    return printer_service.get_queue_status()

@router.post("/print-queue/retry")
def retry_print_queue(current_user: Usuario = Depends(get_current_user)):
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
def get_produtos(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna todos os produtos cadastrados no cardápio, ordenados por ID dentro de cada categoria."""
    return (
        db.query(Produto)
        .options(joinedload(Produto.categoria))
        .order_by(Produto.id)
        .all()
    )

@router.get("/{produto_id}", response_model=ProdutoResponse)
def get_produto(produto_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Busca um produto específico no cardápio pelo ID."""
    produto = db.query(Produto).filter(Produto.id == produto_id).first()
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
    current_user: Usuario = Depends(get_current_user)
):
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
    sincronizar_cardapio_json(db)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Produto criado"}, current_user.restaurante_id)
    return novo_produto

@router.put("/{produto_id}", response_model=ProdutoResponse)
def update_produto(
    produto_id: str, 
    update_data: ProdutoUpdate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
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
    sincronizar_cardapio_json(db)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Produto atualizado"}, current_user.restaurante_id)
    return db_produto

@router.delete("/{produto_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_produto(
    produto_id: str, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Remove definitivamente um produto do cardápio."""
    db_produto = db.query(Produto).filter(Produto.id == produto_id).first()
    if not db_produto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Produto não encontrado"
        )
    db.delete(db_produto)
    db.commit()
    sincronizar_cardapio_json(db)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Produto excluído"}, current_user.restaurante_id)
    return

class ProdutoImportItem(BaseModel):
    id: str
    nome: str
    preco: float
    categoria_id: str
    descricao: Optional[str] = None
    imagem: Optional[str] = None
    ativo: Optional[bool] = True

class CardapioImportPayload(BaseModel):
    categories: Optional[List[str]] = None
    products: Optional[List[ProdutoImportItem]] = None

@router.post("/importar", response_model=List[ProdutoResponse])
def importar_cardapio(
    payload: Union[List[ProdutoImportItem], CardapioImportPayload],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Importa uma lista de produtos sobrescrevendo o cardápio atual.
    Suporta tanto lista direta de produtos quanto formato composto {categories, products}.
    Produtos antigos que não estão no novo cardápio serão inativados (ativo = False).
    Reescreve o arquivo backend/dump.json e notifica via WebSocket.
    """
    rest_id = require_tenant_id()

    if isinstance(payload, CardapioImportPayload):
        produtos_data = payload.products or []
        # Opcionalmente podemos criar/garantir categorias da lista de categorias se informadas
        if payload.categories:
            for cat_nome in payload.categories:
                # Gerar ID a partir do nome
                import unicodedata
                import re
                id_cat = unicodedata.normalize('NFKD', cat_nome).encode('ascii', 'ignore').decode('utf-8').lower()
                id_cat = re.sub(r'[^a-z0-9\-]+', '-', id_cat).strip('-')
                id_cat = f"cat-{id_cat}"
                
                cat = db.query(Categoria).filter(Categoria.id == id_cat).first()
                if not cat:
                    destino = "COZINHA"
                    if "suco" in id_cat or "refri" in id_cat or "cerveja" in id_cat or "bebida" in id_cat:
                        destino = "NENHUM"
                    cat = Categoria(id=id_cat, nome=cat_nome, destino_impressao=destino)
                    db.add(cat)
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
        cat = db.query(Categoria).filter(Categoria.id == cat_id).first()
        if not cat:
            nome_cat = cat_id.replace("cat-", "").replace("-", " ").replace("_", " ").title()
            destino = "COZINHA"
            if cat_id in ["cat-refri", "cat-cervejas"]:
                destino = "NENHUM"
            cat = Categoria(id=cat_id, nome=nome_cat, destino_impressao=destino)
            db.add(cat)
            db.flush()
            
        existente = db.query(Produto).filter(Produto.id == item.id).first()
        if existente:
            existente.nome = item.nome
            existente.preco = item.preco
            existente.categoria_id = item.categoria_id
            if item.descricao is not None:
                existente.descricao = item.descricao
            if item.imagem is not None:
                existente.imagem = item.imagem
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
                ativo=item.ativo if item.ativo is not None else True
            )
            db.add(novo)
            imported_products.append(novo)

    db.flush()

    # 3. Limpeza preventiva de categorias órfãs (sem produtos ativos e sem observações)
    # (Nenhum produto inativo é deletado do banco fisicamente, conforme regras)
    categorias = db.query(Categoria).all()
    for c in categorias:
        produtos_ativos_cat = db.query(Produto).filter(Produto.categoria_id == c.id, Produto.ativo == True).first()
        if not produtos_ativos_cat:
            obs_vinculo = db.query(ObservacaoPredefinida).filter(ObservacaoPredefinida.categoria_id == c.id).first()
            if not obs_vinculo:
                # Garantir que não existam produtos inativos remanescentes vinculados
                prod_inativo = db.query(Produto).filter(Produto.categoria_id == c.id).first()
                if not prod_inativo:
                    db.delete(c)

    # 4. Um único db.commit() no final de toda a operação de import
    db.commit()

    # 5. Refresh nos produtos importados para carregar relações e dados do banco pós-commit
    for prod in imported_products:
        db.refresh(prod)

    # 6. Sincronizar o dump.json contendo apenas o cardápio ativo
    sincronizar_cardapio_json(db)
    
    # 7. Notificar os terminais em tempo real
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    background_tasks.add_task(manager.broadcast, {"type": "catalog_updated", "message": "Cardápio importado"}, current_user.restaurante_id)
    
    return imported_products

