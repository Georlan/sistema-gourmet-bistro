import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..adapters.orders.pos_adapter import PosAdapter
from ..adapters.orders.waiter_modifiers_adapter import WaiterModifiersAdapter
from ..catalog_addons import (
    CategoriaGrupoModificador,
    category_hierarchy_payload,
    effective_modifier_payloads_by_product,
    replace_category_links_for_group,
)
from ..database import get_db, require_tenant_id
from ..models import GrupoModificador, OpcaoModificador, ProdutoGrupoModificador, Produto, Usuario
from ..schemas import (
    GrupoModificadorCreate,
    GrupoModificadorResponse,
    LancamentoResponse,
    OpcaoModificadorResponse,
    VendaDiretaCreate,
)
from ..security import get_current_user, require_permission
from ..websocket_manager import manager

router = APIRouter(
    prefix="/cardapio/modificadores",
    tags=["Modificadores e Complementos"]
)

# Tombstone interno para remover um grupo da configuração ativa sem quebrar
# referências históricas de pedidos. O schema público de criação não aceita esse
# valor; ele existe somente para reparos administrativos auditados.
ARCHIVED_MODIFIER_TYPE = "__archived__"


class GrupoModificadorCreateV2(GrupoModificadorCreate):
    categoria_ids: List[str] = Field(default_factory=list)
    incluir_subcategorias: bool = True


class GrupoModificadorResponseV2(GrupoModificadorResponse):
    categoria_ids: List[str] = Field(default_factory=list)
    incluir_subcategorias: bool = True


class ItemComModificadoresCreate(BaseModel):
    produto_id: str
    observacao: str = ""
    cliente_nome: str = "Consumo Geral"
    modificador_ids: List[str] = Field(default_factory=list, max_length=100)


class LancamentoComModificadoresCreate(BaseModel):
    garcom_id: str
    origem: Optional[Literal["smartpos"]] = None
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=128)
    itens: List[ItemComModificadoresCreate] = Field(min_length=1, max_length=200)


class VendaDiretaComModificadoresCreate(VendaDiretaCreate):
    itens: List[ItemComModificadoresCreate] = Field(min_length=1, max_length=200)


def _notify_catalog_update(
    background_tasks: BackgroundTasks,
    restaurante_id: int,
    message: str,
) -> None:
    background_tasks.add_task(
        manager.broadcast,
        {"event": "catalog_updated", "message": message},
        restaurante_id,
    )


def _serialize_grupo(grupo: GrupoModificador, db: Session) -> GrupoModificadorResponseV2:
    opcoes = db.query(OpcaoModificador).filter(
        OpcaoModificador.grupo_id == grupo.id,
        OpcaoModificador.restaurante_id == grupo.restaurante_id,
    ).all()
    produtos_vinculados = db.query(ProdutoGrupoModificador.produto_id).filter(
        ProdutoGrupoModificador.grupo_id == grupo.id,
        ProdutoGrupoModificador.restaurante_id == grupo.restaurante_id,
    ).all()
    categorias_vinculadas = db.query(CategoriaGrupoModificador).filter(
        CategoriaGrupoModificador.grupo_id == grupo.id,
        CategoriaGrupoModificador.restaurante_id == grupo.restaurante_id,
    ).all()
    return GrupoModificadorResponseV2(
        id=grupo.id,
        nome=grupo.nome,
        min_selecoes=grupo.min_selecoes,
        max_selecoes=grupo.max_selecoes,
        tipo=grupo.tipo,
        opcoes=[
            OpcaoModificadorResponse(
                id=op.id,
                grupo_id=op.grupo_id,
                nome=op.nome,
                preco_adicional=float(op.preco_adicional or 0.0),
                ativo=op.ativo,
            )
            for op in opcoes
        ],
        produto_ids=[p[0] for p in produtos_vinculados],
        categoria_ids=[str(link.categoria_id) for link in categorias_vinculadas],
        incluir_subcategorias=(
            all(bool(link.incluir_subcategorias) for link in categorias_vinculadas)
            if categorias_vinculadas else True
        ),
    )


def _validate_product_ids(db: Session, restaurante_id: int, product_ids: List[str]) -> None:
    normalized = list(dict.fromkeys(str(pid).strip() for pid in product_ids if str(pid).strip()))
    if not normalized:
        return
    count = db.query(Produto).filter(
        Produto.restaurante_id == restaurante_id,
        Produto.id.in_(normalized),
    ).count()
    if count != len(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Um ou mais produtos não pertencem ao restaurante ativo.",
        )


@router.get("/grupos", response_model=List[GrupoModificadorResponseV2])
def listar_grupos(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    del current_user
    rest_id = require_tenant_id()
    grupos = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == rest_id,
        GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE,
    ).all()
    return [_serialize_grupo(g, db) for g in grupos]


@router.get("/categorias-hierarquia")
def listar_categorias_hierarquia(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    del current_user
    return category_hierarchy_payload(db, require_tenant_id())


@router.get("/efetivos")
def listar_modificadores_efetivos(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    del current_user
    rest_id = require_tenant_id()
    products = db.query(Produto).filter(Produto.restaurante_id == rest_id).all()
    return effective_modifier_payloads_by_product(db, rest_id, products)


@router.get("/publico/{restaurante_id}", response_model=List[GrupoModificadorResponseV2])
def listar_grupos_publico(restaurante_id: int, db: Session = Depends(get_db)):
    grupos = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == restaurante_id,
        GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE,
    ).all()
    return [_serialize_grupo(g, db) for g in grupos]


@router.post("/grupos", response_model=GrupoModificadorResponseV2, status_code=status.HTTP_201_CREATED)
def criar_grupo(
    payload: GrupoModificadorCreateV2,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    del current_user
    rest_id = require_tenant_id()
    _validate_product_ids(db, rest_id, payload.produto_ids or [])
    grupo_id = f"gmod-{uuid.uuid4().hex[:8]}"
    novo_grupo = GrupoModificador(
        id=grupo_id,
        restaurante_id=rest_id,
        nome=payload.nome.strip(),
        min_selecoes=payload.min_selecoes,
        max_selecoes=payload.max_selecoes,
        tipo=payload.tipo,
    )
    db.add(novo_grupo)
    db.flush()
    if payload.opcoes:
        for op in payload.opcoes:
            db.add(OpcaoModificador(
                id=f"opmod-{uuid.uuid4().hex[:8]}", restaurante_id=rest_id,
                grupo_id=grupo_id, nome=op.nome.strip(),
                preco_adicional=op.preco_adicional or 0.0, ativo=op.ativo,
            ))
    if payload.produto_ids:
        for pid in dict.fromkeys(payload.produto_ids):
            db.add(ProdutoGrupoModificador(restaurante_id=rest_id, produto_id=pid, grupo_id=grupo_id))
    try:
        replace_category_links_for_group(
            db, restaurante_id=rest_id, grupo_id=grupo_id,
            categoria_ids=payload.categoria_ids,
            incluir_subcategorias=payload.incluir_subcategorias,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(novo_grupo)
    _notify_catalog_update(background_tasks, rest_id, "Grupo de complementos criado.")
    return _serialize_grupo(novo_grupo, db)


@router.put("/grupos/{grupo_id}", response_model=GrupoModificadorResponseV2)
def atualizar_grupo(
    grupo_id: str,
    payload: GrupoModificadorCreateV2,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    del current_user
    rest_id = require_tenant_id()
    grupo = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == rest_id,
        GrupoModificador.id == grupo_id,
        GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE,
    ).first()
    if not grupo:
        raise HTTPException(status_code=404, detail="Grupo não encontrado.")
    _validate_product_ids(db, rest_id, payload.produto_ids or [])
    grupo.nome = payload.nome.strip()
    grupo.min_selecoes = payload.min_selecoes
    grupo.max_selecoes = payload.max_selecoes
    grupo.tipo = payload.tipo
    if payload.opcoes is not None:
        db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == rest_id,
            OpcaoModificador.grupo_id == grupo_id,
        ).delete()
        for op in payload.opcoes:
            db.add(OpcaoModificador(
                id=op.id or f"opmod-{uuid.uuid4().hex[:8]}", restaurante_id=rest_id,
                grupo_id=grupo_id, nome=op.nome.strip(),
                preco_adicional=op.preco_adicional or 0.0, ativo=op.ativo,
            ))
    if payload.produto_ids is not None:
        db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == rest_id,
            ProdutoGrupoModificador.grupo_id == grupo_id,
        ).delete()
        for pid in dict.fromkeys(payload.produto_ids):
            db.add(ProdutoGrupoModificador(restaurante_id=rest_id, produto_id=pid, grupo_id=grupo_id))
    try:
        replace_category_links_for_group(
            db, restaurante_id=rest_id, grupo_id=grupo_id,
            categoria_ids=payload.categoria_ids,
            incluir_subcategorias=payload.incluir_subcategorias,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(grupo)
    _notify_catalog_update(background_tasks, rest_id, "Grupo de complementos atualizado.")
    return _serialize_grupo(grupo, db)


@router.delete("/grupos/{grupo_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_grupo(
    grupo_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    del current_user
    rest_id = require_tenant_id()
    grupo = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == rest_id,
        GrupoModificador.id == grupo_id,
        GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE,
    ).first()
    if not grupo:
        raise HTTPException(status_code=404, detail="Grupo não encontrado.")
    db.query(ProdutoGrupoModificador).filter(
        ProdutoGrupoModificador.restaurante_id == rest_id,
        ProdutoGrupoModificador.grupo_id == grupo_id,
    ).delete()
    db.query(CategoriaGrupoModificador).filter(
        CategoriaGrupoModificador.restaurante_id == rest_id,
        CategoriaGrupoModificador.grupo_id == grupo_id,
    ).delete()
    db.query(OpcaoModificador).filter(
        OpcaoModificador.restaurante_id == rest_id,
        OpcaoModificador.grupo_id == grupo_id,
    ).delete()
    db.delete(grupo)
    db.commit()
    _notify_catalog_update(background_tasks, rest_id, "Grupo de complementos removido.")
    return None


@router.post("/venda-direta")
def criar_venda_direta_com_modificadores(
    payload: VendaDiretaComModificadoresCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Venda do Caixa com o mesmo Core de Pedidos e IDs de complementos."""
    return PosAdapter.handle_create_pos_order(
        venda_in=payload,
        background_tasks=background_tasks,
        db=db,
        current_user=current_user,
    )


@router.post("/lancamentos/{comanda_id}", response_model=LancamentoResponse)
def lancar_itens_com_modificadores(
    comanda_id: str,
    payload: LancamentoComModificadoresCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Lança pedido de garçom/caixa preservando os IDs canônicos dos complementos."""
    return WaiterModifiersAdapter.handle_launch_items(
        comanda_id=comanda_id,
        lancamento_in=payload,
        background_tasks=background_tasks,
        db=db,
        current_user=current_user,
    )