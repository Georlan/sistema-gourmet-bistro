"""Universal family/variation editor. Real Produto IDs remain the checkout identity."""
from decimal import Decimal
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..marmitaria_catalog import enabled as marmitaria_enabled
from ..models import Cardapio, Categoria, GrupoModificador, Produto, ProdutoFamilia, ProdutoFamiliaGrupoModificador, Usuario
from ..security import get_current_user, require_permission
from ..services.storage_paths import validate_tenant_storage_reference
from .products import notify_catalog_update

router = APIRouter(prefix="/produto-familias", tags=["Famílias de produtos"])


class VariantWrite(BaseModel):
    produto_id: str | None = None  # SKU já existente ou criação de novo SKU
    rotulo: str = Field(min_length=1, max_length=100)
    preco: Decimal = Field(ge=0, le=1000000, max_digits=12, decimal_places=2)
    ativo: bool = True

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("rotulo")
    @classmethod
    def nonempty_label(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Informe um nome para a variação.")
        return value.strip()


class FamilyWrite(BaseModel):
    nome: str = Field(min_length=1, max_length=160)
    descricao: str = Field(default="", max_length=2000)
    eixo: Literal["tamanho", "sabor", "outra"] = "tamanho"
    categoria_id: str = Field(min_length=1)
    cardapio_id: str | None = None
    imagem: str = ""
    variantes: list[VariantWrite] = Field(min_length=1, max_length=100)
    # Optional atomic update; older callers that omit it keep existing links intact.
    grupo_ids: list[str] | None = Field(default=None, max_length=100)
    grupos_anteriores: list[str] | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("nome")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Informe o nome do produto.")
        return value.strip()


class FamilyPersonalizationsUpdate(BaseModel):
    """The shared choices visible in every variant (not the flavor/size)."""

    model_config = ConfigDict(extra="forbid")
    grupo_ids: list[str] = Field(default_factory=list, max_length=100)
    grupos_anteriores: list[str] = Field(default_factory=list, max_length=100)


def _family_group_ids(db: Session, tenant: int, family_id: str) -> list[str]:
    return sorted({
        str(row.grupo_id)
        for row in db.query(ProdutoFamiliaGrupoModificador).filter(
            ProdutoFamiliaGrupoModificador.restaurante_id == tenant,
            ProdutoFamiliaGrupoModificador.familia_id == family_id,
        ).all()
    })


def _family_response(family: ProdutoFamilia, products: list[Produto]) -> dict:
    return {
        "id": family.id,
        "nome": family.nome,
        "descricao": family.descricao,
        "eixo": family.eixo,
        "categoria_id": family.categoria_id,
        "cardapio_id": family.cardapio_id,
        "imagem": family.imagem,
        "variantes": [
            {
                "produto_id": product.id,
                "rotulo": product.variacao_rotulo,
                "nome": product.nome,
                "preco": float(product.preco),
                "ativo": product.ativo,
            }
            for product in products if product.familia_id == family.id
        ],
    }


@router.get("")
def list_families(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    del current_user
    tenant = require_tenant_id()
    families = db.query(ProdutoFamilia).filter(ProdutoFamilia.restaurante_id == tenant).order_by(ProdutoFamilia.nome).all()
    if not families:
        return []
    products = db.query(Produto).filter(Produto.restaurante_id == tenant, Produto.familia_id.in_([f.id for f in families])).all()
    # Group inheritance belongs to the existing canonical modifier resolver.
    # Family membership never duplicates or unions per-SKU personalization.
    return [_family_response(f, products) for f in families]


@router.get("/{family_id}/personalizacoes")
def get_family_personalizations(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    del current_user
    tenant = require_tenant_id()
    family = db.query(ProdutoFamilia).filter(
        ProdutoFamilia.id == family_id,
        ProdutoFamilia.restaurante_id == tenant,
    ).first()
    if family is None:
        raise HTTPException(404, "Produto com variações não encontrado.")
    return {"familia_id": family_id, "grupo_ids": _family_group_ids(db, tenant, family_id)}


@router.put("/{family_id}/personalizacoes")
def update_family_personalizations(
    family_id: str,
    payload: FamilyPersonalizationsUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    """Reuse existing groups without copying them into each variant's SKU."""
    del current_user
    tenant = require_tenant_id()
    if marmitaria_enabled(db, tenant):
        raise HTTPException(409, "A composição de marmitas tem regras próprias.")
    family = db.query(ProdutoFamilia).filter(
        ProdutoFamilia.id == family_id,
        ProdutoFamilia.restaurante_id == tenant,
    ).with_for_update().first()
    if family is None:
        raise HTTPException(404, "Produto com variações não encontrado.")

    requested = [value.strip() for value in payload.grupo_ids]
    expected = [value.strip() for value in payload.grupos_anteriores]
    if any(not value for value in requested + expected):
        raise HTTPException(422, "Identificador de personalização inválido.")
    if len(set(requested)) != len(requested) or len(set(expected)) != len(expected):
        raise HTTPException(422, "Não repita a mesma personalização.")

    existing = db.query(ProdutoFamiliaGrupoModificador).filter(
        ProdutoFamiliaGrupoModificador.restaurante_id == tenant,
        ProdutoFamiliaGrupoModificador.familia_id == family_id,
    ).with_for_update().all()
    existing_ids = {str(link.grupo_id) for link in existing}
    if existing_ids != set(expected):
        raise HTTPException(409, "As personalizações mudaram em outro acesso. Reabra o produto.")

    valid = {
        str(group.id)
        for group in db.query(GrupoModificador).filter(
            GrupoModificador.restaurante_id == tenant,
            GrupoModificador.id.in_(requested),
            GrupoModificador.tipo.in_(("opcional", "obrigatorio", "meio_a_meio")),
        ).all()
    } if requested else set()
    if valid != set(requested):
        raise HTTPException(422, "Grupo inválido ou pertencente a outro restaurante.")

    for link in existing:
        if link.grupo_id not in requested:
            db.delete(link)
    for group_id in set(requested) - existing_ids:
        db.add(ProdutoFamiliaGrupoModificador(
            restaurante_id=tenant, familia_id=family_id, grupo_id=group_id,
        ))
    db.commit()
    notify_catalog_update(background_tasks, "Escolhas do produto com variações atualizadas", tenant)
    return {"familia_id": family_id, "grupo_ids": sorted(set(requested))}



def _write_family(
    db: Session,
    tenant: int,
    payload: FamilyWrite,
    existing: ProdutoFamilia | None,
) -> dict:
    if marmitaria_enabled(db, tenant):
        raise HTTPException(409, "No modo Marmitaria, configure tamanhos em Marmitas. Não use famílias de variações.")

    category = db.query(Categoria).filter(
        Categoria.restaurante_id == tenant, Categoria.id == payload.categoria_id
    ).first()
    if category is None:
        raise HTTPException(400, "Categoria não encontrada neste restaurante.")
    if payload.cardapio_id and not db.query(Cardapio.id).filter(
        Cardapio.restaurante_id == tenant, Cardapio.id == payload.cardapio_id,
    ).first():
        raise HTTPException(400, "Cardápio operacional inválido.")

    labels = [variant.rotulo.casefold() for variant in payload.variantes]
    if len(labels) != len(set(labels)):
        raise HTTPException(422, "Cada variação precisa de um nome diferente.")
    # Validate a shared group edit BEFORE writing any member SKU. This makes
    # the single editor save one transaction (family + variants + choices).
    shared_links: list[ProdutoFamiliaGrupoModificador] = []
    shared_requested: set[str] | None = None
    if payload.grupo_ids is not None:
        requested_groups = [value.strip() for value in payload.grupo_ids]
        previous_groups = [value.strip() for value in (payload.grupos_anteriores or [])]
        if any(not value for value in requested_groups + previous_groups):
            raise HTTPException(422, "Identificador de personalização inválido.")
        if len(set(requested_groups)) != len(requested_groups) or len(set(previous_groups)) != len(previous_groups):
            raise HTTPException(422, "Não repita a mesma personalização.")
        if existing is not None:
            shared_links = db.query(ProdutoFamiliaGrupoModificador).filter(
                ProdutoFamiliaGrupoModificador.restaurante_id == tenant,
                ProdutoFamiliaGrupoModificador.familia_id == existing.id,
            ).with_for_update().all()
            if {str(row.grupo_id) for row in shared_links} != set(previous_groups):
                raise HTTPException(409, "As personalizações mudaram em outro acesso. Reabra o produto.")
        elif previous_groups:
            raise HTTPException(409, "Não existem personalizações anteriores nesta família.")
        shared_requested = set(requested_groups)
        valid_groups = {
            str(group.id)
            for group in db.query(GrupoModificador).filter(
                GrupoModificador.restaurante_id == tenant,
                GrupoModificador.id.in_(shared_requested),
                GrupoModificador.tipo.in_(("opcional", "obrigatorio", "meio_a_meio")),
            ).all()
        } if shared_requested else set()
        if shared_requested != valid_groups:
            raise HTTPException(422, "Grupo inválido ou pertencente a outro restaurante.")

    requested_ids = [v.produto_id for v in payload.variantes if v.produto_id]
    if len(requested_ids) != len(set(requested_ids)):
        raise HTTPException(422, "Um SKU não pode aparecer duas vezes.")

    existing_members: list[Produto] = []
    if existing is not None:
        existing_members = db.query(Produto).filter(
            Produto.restaurante_id == tenant,
            Produto.familia_id == existing.id,
        ).with_for_update().all()
        missing = {p.id for p in existing_members} - set(requested_ids)
        if missing:
            raise HTTPException(
                409,
                "Remover uma variante exige arquivamento seguro para preservar o histórico. Nenhuma exclusão foi realizada.",
            )

    products_by_id = {
        product.id: product
        for product in db.query(Produto).filter(
            Produto.restaurante_id == tenant,
            Produto.id.in_(requested_ids),
        ).with_for_update().all()
    } if requested_ids else {}
    if len(products_by_id) != len(requested_ids):
        raise HTTPException(404, "Um dos produtos selecionados não existe neste restaurante.")

    for product in products_by_id.values():
        if product.marmitaria_tamanho:
            raise HTTPException(409, "Tamanhos de marmita não podem ser usados como variantes genéricas.")
        if product.familia_id and (existing is None or product.familia_id != existing.id):
            raise HTTPException(409, "Produto já pertence a outra família.")
        if product.categoria_id != payload.categoria_id or product.cardapio_id != payload.cardapio_id:
            raise HTTPException(409, "As variantes precisam estar na mesma categoria e cardápio.")
        if product.somente_promocao:
            raise HTTPException(409, "Itens exclusivos de promoção não podem ser vinculados a famílias.")

    try:
        image = validate_tenant_storage_reference(payload.imagem, tenant, "products") if payload.imagem else ""
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    if existing is None:
        existing = ProdutoFamilia(
            id=str(uuid4()), restaurante_id=tenant,
            nome=payload.nome, descricao=payload.descricao,
            eixo=payload.eixo, categoria_id=payload.categoria_id,
            cardapio_id=payload.cardapio_id, imagem=image,
        )
        db.add(existing)
        db.flush()
    else:
        existing.nome = payload.nome
        existing.descricao = payload.descricao
        existing.eixo = payload.eixo
        existing.categoria_id = payload.categoria_id
        existing.cardapio_id = payload.cardapio_id
        existing.imagem = image

    for variant in payload.variantes:
        if variant.produto_id:
            sku = products_by_id[variant.produto_id]
        else:
            sku = Produto(
                id=str(uuid4()),
                restaurante_id=tenant,
                categoria_id=payload.categoria_id,
                cardapio_id=payload.cardapio_id,
                nome=f"{payload.nome} - {variant.rotulo}",
                descricao=payload.descricao,
                preco=float(variant.preco),
                imagem=image,
                imagens_galeria=[],
                ativo=variant.ativo,
                somente_promocao=False,
                familia_id=existing.id,
                variacao_rotulo=variant.rotulo,
            )
            db.add(sku)
        sku.familia_id = existing.id
        sku.variacao_rotulo = variant.rotulo
        sku.preco = float(variant.preco)
        sku.ativo = variant.ativo

    if shared_requested is not None:
        for row in shared_links:
            if row.grupo_id not in shared_requested:
                db.delete(row)
        previous_ids = {str(row.grupo_id) for row in shared_links}
        for group_id in shared_requested - previous_ids:
            db.add(ProdutoFamiliaGrupoModificador(
                restaurante_id=tenant, familia_id=existing.id, grupo_id=group_id,
            ))
    db.flush()
    members = db.query(Produto).filter(
        Produto.restaurante_id == tenant, Produto.familia_id == existing.id,
    ).all()
    response = _family_response(existing, members)
    if shared_requested is not None:
        response["grupo_ids"] = sorted(shared_requested)
    db.commit()
    return response


@router.post("", status_code=201)
def create_family(
    payload: FamilyWrite,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    del current_user
    tenant = require_tenant_id()
    result = _write_family(db, tenant, payload, None)
    notify_catalog_update(background_tasks, "Família de produtos criada", tenant)
    return result


@router.put("/{family_id}")
def update_family(
    family_id: str,
    payload: FamilyWrite,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    del current_user
    tenant = require_tenant_id()
    family = db.query(ProdutoFamilia).filter(
        ProdutoFamilia.restaurante_id == tenant, ProdutoFamilia.id == family_id,
    ).with_for_update().first()
    if family is None:
        raise HTTPException(404, "Família não encontrada neste restaurante.")
    result = _write_family(db, tenant, payload, family)
    notify_catalog_update(background_tasks, "Família de produtos atualizada", tenant)
    return result
