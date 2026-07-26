import os
import uuid
import httpx
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from ..config import settings
from ..database import get_db, require_tenant_id, current_restaurante_id
from ..models import Restaurante, Usuario, Categoria, Produto
from ..security import require_permission, get_current_garcom_optional
from ..schemas import RestauranteConfigResponse, RestauranteConfigUpdate

logger = logging.getLogger("koma.cardapio_digital")
router = APIRouter(prefix="/api/cardapio-digital", tags=["Cardapio Digital Assets"])

def resolve_restaurant_id(restaurante_id: Optional[str], slug: Optional[str], db: Session, current_user: Optional[Usuario] = None) -> int:
    """
    Resolve dinamicamente o restaurante_id a partir do ID, slug ou sessão autenticada.
    Lança HTTP 400 se o identificador não for fornecido ou HTTP 404 se não for localizado.
    """
    rest_id = None
    if restaurante_id:
        if str(restaurante_id).isdigit():
            rest_id = int(restaurante_id)
        elif not slug:
            slug = str(restaurante_id)

    if slug:
        rest = db.query(Restaurante).filter(Restaurante.slug == slug).first()
        if rest:
            return rest.id

    if rest_id:
        rest = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
        if rest:
            return rest.id

    ctx_id = current_restaurante_id.get() or (current_user.tenant_id if current_user else None) or (current_user.restaurante_id if current_user else None)
    if ctx_id:
        return ctx_id

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Identificador de restaurante é obrigatório."
    )

@router.get("/config", response_model=RestauranteConfigResponse)
@router.get("/", response_model=RestauranteConfigResponse)
def obter_config_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Retorna as configurações whitelabel de personalização do restaurante ativo.
    Filtra dinamicamente por restaurante_id (int ou string) ou slug.
    """
    rest_id = resolve_restaurant_id(restaurante_id, slug, db, current_user)
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado."
        )

    return restaurante


@router.get("/categorias")
def obter_categorias_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna as categorias ativas do restaurante especificado para o cardápio digital (isolamento multi-tenant)."""
    rest_id = resolve_restaurant_id(restaurante_id, slug, db)
    categorias = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()

    order_list = [
        "Hambúrgueres Bovinos", "Hambúrgueres de Frango", "Hambúrgueres Suínos",
        "Baguetes", "Pastéis Tradicionais", "Pastelões Especiais", "Pastéis Doces",
        "Petiscos", "Combos Promocionais", "Sucos", "Refrigerantes e Águas",
        "Cervejas", "Bebidas Quentes"
    ]
    sorted_cats = sorted(
        categorias,
        key=lambda c: order_list.index(c.nome) if c.nome in order_list else len(order_list)
    )
    return [
        {
            "id": c.id,
            "nome": c.nome,
            "destino_impressao": getattr(c, "destino_impressao", "COZINHA")
        } for c in sorted_cats
    ]


@router.get("/produtos")
def obter_produtos_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna os produtos ativos do restaurante especificado para o cardápio digital (isolamento multi-tenant)."""
    rest_id = resolve_restaurant_id(restaurante_id, slug, db)
    produtos = db.query(Produto).filter(
        Produto.restaurante_id == rest_id,
        Produto.ativo == True
    ).all()

    return [
        {
            "id": p.id,
            "nome": p.nome,
            "descricao": p.descricao or "",
            "preco": float(p.preco) if p.preco is not None else 0.0,
            "imagem_url": getattr(p, "imagem_url", None) or getattr(p, "imagem", "") or "",
            "categoria_id": p.categoria_id,
            "ativo": p.ativo,
            "destaque": getattr(p, "destaque", False),
            "opcoes": getattr(p, "opcoes", None)
        } for p in produtos
    ]


@router.put("/config", response_model=RestauranteConfigResponse)
@router.post("/config", response_model=RestauranteConfigResponse)
@router.put("/", response_model=RestauranteConfigResponse)
@router.post("/", response_model=RestauranteConfigResponse)
def atualizar_config_cardapio_digital(
    config_in: RestauranteConfigUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar"))
):
    """
    Atualiza e persiste as configurações whitelabel de personalização do restaurante.
    Filtra pelo restaurante_id / tenant autenticado do usuário logado e salva com db.commit().
    """
    rest_id = getattr(current_user, "restaurante_id", None) or getattr(current_user, "tenant_id", None) or current_restaurante_id.get()
    if not rest_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Restaurante não identificado na sessão do usuário."
        )

    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado para atualização."
        )

    if config_in.nome is not None:
        restaurante.nome = config_in.nome
    if config_in.slug is not None:
        restaurante.slug = config_in.slug
    if config_in.logo_url is not None:
        restaurante.logo_url = config_in.logo_url
    if config_in.banner_url is not None:
        restaurante.banner_url = config_in.banner_url
    if config_in.subtitulo is not None:
        restaurante.subtitulo = config_in.subtitulo
    if config_in.sobre_nos is not None:
        restaurante.sobre_nos = config_in.sobre_nos
    if config_in.endereco is not None:
        restaurante.endereco = config_in.endereco
    if config_in.google_maps_url is not None:
        restaurante.google_maps_url = config_in.google_maps_url
    if config_in.latitude is not None:
        restaurante.latitude = config_in.latitude
    if config_in.longitude is not None:
        restaurante.longitude = config_in.longitude
    if config_in.socials is not None:
        restaurante.socials = config_in.socials
    if config_in.horarios_funcionamento is not None:
        restaurante.horarios_funcionamento = config_in.horarios_funcionamento
    if config_in.formas_pagamento_aceitas is not None:
        restaurante.formas_pagamento_aceitas = config_in.formas_pagamento_aceitas
    if config_in.status_override is not None:
        restaurante.status_override = config_in.status_override
    if config_in.cor_primaria is not None:
        restaurante.cor_primaria = config_in.cor_primaria
    if config_in.cor_fundo is not None:
        restaurante.cor_fundo = config_in.cor_fundo

    db.commit()
    db.refresh(restaurante)
    return restaurante
