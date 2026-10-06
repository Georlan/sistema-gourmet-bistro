from ..services.online_payments.service import OnlinePaymentService
from contextlib import contextmanager
import logging
from typing import Optional
from urllib.parse import quote
import uuid

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy import text
from sqlalchemy.orm import Session, load_only, raiseload

from ..catalog_addons import effective_modifier_payloads_by_product
from ..marmitaria_catalog import enabled as marmitaria_enabled
from ..config import settings
from ..database import (
    bind_session_to_tenant,
    current_restaurante_id,
    get_db,
    require_tenant_id,
    tenant_session_scope,
)
from ..models import (
    Categoria,
    ConfiguracaoRestaurante,
    Produto,
    Restaurante,
    Usuario,
)
from ..security import require_permission, get_current_garcom_optional
from ..schemas import (
    CardapioPublicRestaurantResponse,
    CardapioPublicResponse,
    DeliveryFeeQuoteRequest,
    DeliveryFeeQuoteResponse,
    RestauranteConfigResponse,
    RestauranteConfigUpdate,
)
from ..websocket_manager import manager
from ..services.plan_entitlements import ENTITLEMENT_COUPONS, ENTITLEMENT_LOYALTY, resolve_plan_entitlements
from ..services.restaurant_profile import apply_restaurant_profile_update
from ..services.image_optimization import ImageOptimizerBusy, InvalidImage, optimize_image
from ..services.storage_paths import storage_object_path as _storage_object_path
from ..services.online_order_policy import (
    evaluate_online_order_policy,
    next_schedule_opening,
    next_schedule_opening_label,
)
from ..services.delivery_fee_policy import resolve_distance_delivery_fee
from .products import notify_catalog_update, ordered_categories as _ordered_categories

logger = logging.getLogger("koma.cardapio_digital")
router = APIRouter(prefix="/api/cardapio-digital", tags=["Cardapio Digital Assets"])

MAX_ASSET_SIZE = 5 * 1024 * 1024
ALLOWED_ASSET_TYPES = {
    "image/png": ("png", b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": ("jpg", b"\xff\xd8\xff"),
    "image/webp": ("webp", b"RIFF"),
}


def notify_cardapio_config_update(
    background_tasks: BackgroundTasks,
    restaurante_id: int,
) -> None:
    """Invalida configurações do cardápio em todos os canais do tenant."""
    background_tasks.add_task(
        manager.broadcast,
        {"event": "config_updated"},
        restaurante_id,
    )


def _validate_asset_content(content_type: str, content: bytes) -> str:
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    asset_type = ALLOWED_ASSET_TYPES.get(normalized_type)
    if asset_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de arquivo inválido. Use PNG, JPEG ou WebP.",
        )

    extension, signature = asset_type
    has_valid_signature = content.startswith(signature)
    if normalized_type == "image/webp":
        has_valid_signature = (
            len(content) >= 12
            and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP"
        )
    if not has_valid_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O conteúdo do arquivo não corresponde ao formato informado.",
        )
    return extension


async def _prepare_public_image(content: bytes, kind: str):
    try:
        return await run_in_threadpool(optimize_image, content, kind)
    except InvalidImage as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ImageOptimizerBusy as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": "2"}) from exc


def _supabase_storage_headers(content_type: Optional[str] = None) -> dict:
    service_key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not service_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Armazenamento de imagens não configurado.",
        )
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    if content_type:
        headers["Content-Type"] = content_type
        headers["x-upsert"] = "false"
        headers["Cache-Control"] = "max-age=31536000, immutable"
    return headers


def _supabase_storage_url() -> str:
    storage_url = settings.SUPABASE_URL.rstrip("/")
    if not storage_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Armazenamento de imagens não configurado.",
        )
    return storage_url


async def _delete_storage_object_best_effort(
    object_path: str,
    restaurante_id: int,
    asset_label: str,
) -> None:
    """Remove objeto antigo sem transformar uma troca já concluída em erro para o operador."""
    delete_url = f"{_supabase_storage_url()}/storage/v1/object/cardapio-assets"
    try:
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            response = await client.request(
                "DELETE",
                delete_url,
                headers=_supabase_storage_headers(),
                json={"prefixes": [object_path]},
            )
        if response.status_code not in {
            status.HTTP_200_OK,
            status.HTTP_204_NO_CONTENT,
            status.HTTP_404_NOT_FOUND,
        }:
            logger.warning(
                "Storage rejeitou limpeza de %s do restaurante %s com HTTP %s.",
                asset_label,
                restaurante_id,
                response.status_code,
            )
    except (httpx.HTTPError, HTTPException) as exc:
        logger.warning(
            "Falha ao limpar %s antigo do restaurante %s: %s.",
            asset_label,
            restaurante_id,
            type(exc).__name__,
        )


from ..services.public_orders import resolve_restaurant_id


@contextmanager
def public_tenant_scope(
    restaurante_id: Optional[str],
    slug: Optional[str],
    db: Session,
    current_user: Optional[Usuario] = None,
):
    """Mantém ORM e RLS vinculados ao mesmo tenant e restaura a sessão ao sair."""
    rest_id = resolve_restaurant_id(
        restaurante_id,
        slug,
        db,
        current_user,
        bind_session=False,
    )
    with tenant_session_scope(db, rest_id):
        yield rest_id


def _public_benefit_capabilities(db: Session, restaurante_id: int, stored_plan: str | None = None) -> dict[str, bool]:
    """Publica capacidades efetivas sem expor plano, saldos ou cupons privados."""
    capabilities = resolve_plan_entitlements(
        db, restaurante_id, stored_plan=stored_plan,
        entitlements=(ENTITLEMENT_COUPONS, ENTITLEMENT_LOYALTY),
    )
    coupons = capabilities[ENTITLEMENT_COUPONS]
    loyalty = capabilities[ENTITLEMENT_LOYALTY]
    # Pausar ou trocar a modalidade de acúmulo preserva saldos já conquistados.
    return {"coupons": coupons, "loyalty": loyalty, "cashback": loyalty}


def _public_configuration(db: Session, restaurante_id: int) -> ConfiguracaoRestaurante | None:
    # No joined restaurant, integration secrets or internal printing/settings data.
    # raiseload makes any accidental dependency on omitted fields explicit.
    return db.query(ConfiguracaoRestaurante).options(
        load_only(
            ConfiguracaoRestaurante.restaurante_id,
            ConfiguracaoRestaurante.delivery_ativo,
            ConfiguracaoRestaurante.tipos_pedido_ativos,
            ConfiguracaoRestaurante.pedido_minimo,
            ConfiguracaoRestaurante.pedido_minimo_retirada,
            ConfiguracaoRestaurante.frete_gratis_valor,
            ConfiguracaoRestaurante.tipo_taxa_entrega,
            ConfiguracaoRestaurante.taxa_entrega_fixa,
            ConfiguracaoRestaurante.tabela_taxas_bairros,
            ConfiguracaoRestaurante.tabela_taxas_km,
            ConfiguracaoRestaurante.delivery_area_policy,
            raiseload=True,
        ),
        raiseload(ConfiguracaoRestaurante.restaurante),
    ).filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id).first()


def _public_restaurant_payload(
    restaurante: Restaurante,
    configuracao: Optional[ConfiguracaoRestaurante] = None,
    pagamento_online_ativo: bool = False,
    beneficios: Optional[dict[str, bool]] = None,
) -> dict:
    policy = evaluate_online_order_policy(restaurante, configuracao)
    next_opening = (
        next_schedule_opening(restaurante.horarios_funcionamento)
        if not policy.accepting_orders and policy.source == "schedule"
        else None
    )
    next_opening_label = (
        next_schedule_opening_label(restaurante.horarios_funcionamento)
        if next_opening is not None
        else None
    )
    return {
        "id": restaurante.id,
        "nome": restaurante.nome,
        "slug": restaurante.slug,
        "logo_url": restaurante.logo_url or restaurante.cardapio_logo_path,
        "banner_url": restaurante.banner_url or restaurante.cardapio_banner_path,
        "subtitulo": restaurante.subtitulo,
        "sobre_nos": restaurante.sobre_nos,
        "endereco": restaurante.endereco,
        "google_maps_url": restaurante.google_maps_url,
        "status_override": restaurante.status_override,
        "aceitando_pedidos": policy.accepting_orders,
        "motivo_indisponibilidade": policy.reason,
        "origem_disponibilidade": policy.source,
        "proxima_abertura": next_opening.isoformat() if next_opening is not None else None,
        "proxima_abertura_texto": next_opening_label,
        "socials": restaurante.socials,
        "horarios_funcionamento": restaurante.horarios_funcionamento,
        "formas_pagamento_aceitas": restaurante.formas_pagamento_aceitas,
        "pagamento_online_ativo": pagamento_online_ativo,
        "beneficios": beneficios or {"coupons": False, "loyalty": False, "cashback": False},
        "conta_cliente_obrigatoria": bool(settings.CUSTOMER_ACCOUNT_REQUIRED_FOR_ORDERS),
        "tipos_pedido_ativos": configuracao.tipos_pedido_ativos if configuracao else None,
        "delivery_ativo": configuracao.delivery_ativo is not False if configuracao else True,
        "cor_primaria": restaurante.cor_primaria,
        "cor_fundo": restaurante.cor_fundo,
        "pedido_minimo": float(configuracao.pedido_minimo or 0.0) if configuracao and configuracao.pedido_minimo is not None else 0.0,
        "pedido_minimo_retirada": bool(getattr(configuracao, "pedido_minimo_retirada", False)) if configuracao else False,
        "frete_gratis_valor": float(configuracao.frete_gratis_valor or 0.0) if configuracao and configuracao.frete_gratis_valor is not None else 0.0,
        "tipo_taxa_entrega": configuracao.tipo_taxa_entrega if configuracao and configuracao.tipo_taxa_entrega else "fixa",
        "taxa_entrega_fixa": float(configuracao.taxa_entrega_fixa) if configuracao and configuracao.taxa_entrega_fixa is not None else None,
        "tabela_taxas_bairros": configuracao.tabela_taxas_bairros if configuracao and configuracao.tabela_taxas_bairros else [],
        "tabela_taxas_km": configuracao.tabela_taxas_km if configuracao and configuracao.tabela_taxas_km else [],
        "delivery_area_policy": configuracao.delivery_area_policy if configuracao else None,
        "taxa_entrega_padrao": float(configuracao.taxa_entrega_fixa) if configuracao and configuracao.taxa_entrega_fixa is not None else None,
    }


def _public_category_payload(category: Categoria) -> dict:
    return {"id": category.id, "nome": category.nome}


def _public_product_payload(product: Produto, modifier_groups: Optional[list[dict]] = None, *, marmitaria: bool = False) -> dict:
    return {
        "id": product.id,
        "nome": product.nome,
        "descricao": product.descricao or "",
        "preco": float(product.preco) if product.preco is not None else 0.0,
        "imagem_url": product.imagem or "",
        "imagens_galeria": product.imagens_galeria or [],
        "categoria_id": product.categoria_id,
        "grupos_modificadores": modifier_groups or [],
        "marmitaria": marmitaria,
    }


@router.get("/config", response_model=CardapioPublicRestaurantResponse)
@router.get("/", response_model=CardapioPublicRestaurantResponse)
def obter_config_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """Retorna as configurações whitelabel do restaurante resolvido."""
    with public_tenant_scope(restaurante_id, slug, db, current_user) as rest_id:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
        if not restaurante:
            raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
        configuracao = _public_configuration(db, rest_id)
        pagamento_online_ativo = OnlinePaymentService.has_active_account(db, rest_id)
        return _public_restaurant_payload(
            restaurante, configuracao, pagamento_online_ativo,
            _public_benefit_capabilities(db, rest_id, restaurante.plano),
        )


@router.get("/categorias")
def obter_categorias_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna as categorias do tenant para o cardápio digital."""
    with public_tenant_scope(restaurante_id, slug, db) as rest_id:
        categorias = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()
        return [_public_category_payload(category) for category in _ordered_categories(categorias)]


@router.get("/produtos")
def obter_produtos_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna produtos ativos com os mesmos complementos efetivos do catálogo operacional."""
    with public_tenant_scope(restaurante_id, slug, db) as rest_id:
        produtos = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.ativo.is_(True),
        ).all()
        modifier_payloads = effective_modifier_payloads_by_product(db, rest_id, produtos)
        is_marmitaria = marmitaria_enabled(db, rest_id)
        return [
            {
                **_public_product_payload(
                    product,
                    modifier_payloads.get(str(product.id), []),
                    marmitaria=is_marmitaria,
                ),
                "ativo": True,
            }
            for product in produtos
        ]


@router.get("/public", response_model=CardapioPublicResponse)
def obter_cardapio_publico(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_current_garcom_optional),
):
    """Snapshot público único: restaurante, categorias, produtos e complementos efetivos."""
    with public_tenant_scope(restaurante_id, slug, db, current_user) as rest_id:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
        if not restaurante:
            raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

        configuracao = _public_configuration(db, rest_id)
        pagamento_online_ativo = OnlinePaymentService.has_active_account(db, rest_id)
        categorias = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()
        produtos = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.ativo.is_(True),
        ).all()
        modifier_payloads = effective_modifier_payloads_by_product(db, rest_id, produtos)
        is_marmitaria = marmitaria_enabled(db, rest_id)

        return {
            "restaurante": _public_restaurant_payload(
                restaurante,
                configuracao,
                pagamento_online_ativo,
                _public_benefit_capabilities(db, rest_id, restaurante.plano),
            ),
            "categorias": [
                _public_category_payload(category)
                for category in _ordered_categories(categorias)
            ],
            "produtos": [
                _public_product_payload(
                    product,
                    modifier_payloads.get(str(product.id), []),
                    marmitaria=is_marmitaria,
                )
                for product in produtos
            ],
        }


@router.post("/delivery/quote", response_model=DeliveryFeeQuoteResponse)
def quote_delivery_by_location(
    payload: DeliveryFeeQuoteRequest,
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Cota entrega por distância usando apenas coordenadas e matemática local."""
    with public_tenant_scope(restaurante_id, slug, db) as rest_id:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
        configuracao = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == rest_id
        ).first()
        if not restaurante or not configuracao:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Configurações de entrega não encontradas.",
            )
        if configuracao.tipo_taxa_entrega != "distancia":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A cobrança por distância não está ativa para este restaurante.",
            )

        try:
            fee, distance_km = resolve_distance_delivery_fee(
                configuracao.tabela_taxas_km or [],
                origin_latitude=restaurante.latitude,
                origin_longitude=restaurante.longitude,
                destination_latitude=payload.latitude,
                destination_longitude=payload.longitude,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc

        free_shipping = bool(
            configuracao.frete_gratis_valor
            and float(configuracao.frete_gratis_valor) > 0
            and payload.subtotal >= float(configuracao.frete_gratis_valor)
        )
        if free_shipping:
            fee = fee * 0

        return {
            "available": True,
            "fee": float(fee),
            "distance_km": distance_km,
            "used_fallback": distance_km is None,
            "free_shipping": free_shipping,
            "message": (
                "Taxa mínima aplicada porque não foi possível calcular a distância."
                if distance_km is None
                else None
            ),
        }


@router.post("/assets/product/{produto_id}")
async def upload_product_asset(
    produto_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    """Publica uma única foto do produto no storage do tenant autenticado."""
    del current_user
    rest_id = require_tenant_id()
    produto = db.query(Produto).filter(
        Produto.restaurante_id == rest_id,
        Produto.id == produto_id,
    ).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    content_type = file.content_type or ""
    try:
        content = await file.read(MAX_ASSET_SIZE + 1)
    finally:
        await file.close()
    if len(content) > MAX_ASSET_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo excede o limite máximo de 5 MB.",
        )
    extension = _validate_asset_content(content_type, content)

    # Release the read transaction before CPU work and the external Storage request.
    db.rollback()
    optimized = await _prepare_public_image(content, "products")
    content, content_type, extension = optimized.content, optimized.content_type, optimized.extension

    object_path = f"{rest_id}/products/{uuid.uuid4().hex}.{extension}"
    storage_url = _supabase_storage_url()
    upload_url = (
        f"{storage_url}/storage/v1/object/cardapio-assets/"
        f"{quote(object_path, safe='/')}"
    )
    try:
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            response = await client.post(
                upload_url,
                headers=_supabase_storage_headers(content_type),
                content=content,
            )
    except httpx.HTTPError as exc:
        logger.warning(
            "Falha de rede ao enviar foto do produto %s do restaurante %s: %s.",
            produto_id,
            rest_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível armazenar a imagem.",
        ) from exc

    if response.status_code not in {status.HTTP_200_OK, status.HTTP_201_CREATED}:
        logger.warning(
            "Storage rejeitou foto do produto %s do restaurante %s com HTTP %s.",
            produto_id,
            rest_id,
            response.status_code,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível armazenar a imagem.",
        )

    public_url = (
        f"{storage_url}/storage/v1/object/public/cardapio-assets/"
        f"{quote(object_path, safe='/')}"
    )
    produto = db.query(Produto).filter(
        Produto.restaurante_id == rest_id, Produto.id == produto_id,
    ).populate_existing().with_for_update().first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    produto.imagem = public_url
    produto.imagens_galeria = []
    db.commit()
    db.refresh(produto)

    # The database lifecycle trigger retains replaced references for seven days.
    notify_catalog_update(background_tasks, "Foto do produto atualizada", rest_id)
    return {
        "id": produto.id,
        "imagem": produto.imagem,
        "imagens_galeria": [],
    }


@router.delete("/assets/product/{produto_id}")
async def delete_product_asset(
    produto_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar")),
):
    """Remove a foto do produto sem afetar itens de outros tenants."""
    del current_user
    rest_id = require_tenant_id()
    produto = db.query(Produto).filter(
        Produto.restaurante_id == rest_id,
        Produto.id == produto_id,
    ).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    produto.imagem = ""
    produto.imagens_galeria = []
    db.commit()
    db.refresh(produto)

    # Removal clears the public reference immediately. The durable lifecycle queue
    # retires all removed primary/gallery URLs; shared objects remain protected.
    notify_catalog_update(background_tasks, "Foto do produto removida", rest_id)
    return {
        "id": produto.id,
        "imagem": "",
        "imagens_galeria": [],
    }


@router.post(
    "/assets/{asset_type}",
    response_model=RestauranteConfigResponse,
)
async def upload_cardapio_asset(
    asset_type: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    """Envia logo/banner validado ao bucket e salva somente no tenant autenticado."""
    del current_user
    if asset_type not in {"logo", "banner"}:
        raise HTTPException(status_code=404, detail="Tipo de imagem não encontrado.")

    content_type = file.content_type or ""
    try:
        content = await file.read(MAX_ASSET_SIZE + 1)
    finally:
        await file.close()
    if len(content) > MAX_ASSET_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo excede o limite máximo de 5 MB.",
        )
    extension = _validate_asset_content(content_type, content)

    rest_id = require_tenant_id()
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

    db.rollback()
    optimized = await _prepare_public_image(content, asset_type)
    content, content_type, extension = optimized.content, optimized.content_type, optimized.extension

    object_path = f"{rest_id}/{asset_type}/{uuid.uuid4().hex}.{extension}"
    storage_url = _supabase_storage_url()
    upload_url = (
        f"{storage_url}/storage/v1/object/cardapio-assets/"
        f"{quote(object_path, safe='/')}"
    )
    try:
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            response = await client.post(
                upload_url,
                headers=_supabase_storage_headers(content_type),
                content=content,
            )
    except httpx.HTTPError as exc:
        logger.warning(
            "Falha de rede ao enviar %s do restaurante %s: %s.",
            asset_type,
            rest_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível armazenar a imagem.",
        ) from exc

    if response.status_code not in {status.HTTP_200_OK, status.HTTP_201_CREATED}:
        logger.warning(
            "Storage rejeitou upload de %s do restaurante %s com HTTP %s.",
            asset_type,
            rest_id,
            response.status_code,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível armazenar a imagem.",
        )

    public_url = (
        f"{storage_url}/storage/v1/object/public/cardapio-assets/"
        f"{quote(object_path, safe='/')}"
    )
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
    if asset_type == "logo":
        restaurante.logo_url = public_url
        restaurante.cardapio_logo_path = object_path
    else:
        restaurante.banner_url = public_url
        restaurante.cardapio_banner_path = object_path

    db.commit()
    db.refresh(restaurante)
    notify_cardapio_config_update(background_tasks, rest_id)
    return restaurante


@router.delete(
    "/assets/{asset_type}",
    response_model=RestauranteConfigResponse,
)
async def delete_cardapio_asset(
    asset_type: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    """Remove logo/banner apenas do tenant autenticado."""
    del current_user
    if asset_type not in {"logo", "banner"}:
        raise HTTPException(status_code=404, detail="Tipo de imagem não encontrado.")

    rest_id = require_tenant_id()
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

    current_url = (
        (restaurante.logo_url or restaurante.cardapio_logo_path)
        if asset_type == "logo"
        else (restaurante.banner_url or restaurante.cardapio_banner_path)
    )
    object_path = _storage_object_path(current_url, rest_id, asset_type)
    if object_path:
        delete_url = f"{_supabase_storage_url()}/storage/v1/object/cardapio-assets"
        try:
            async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
                response = await client.request(
                    "DELETE",
                    delete_url,
                    headers=_supabase_storage_headers(),
                    json={"prefixes": [object_path]},
                )
        except httpx.HTTPError as exc:
            logger.warning(
                "Falha de rede ao remover %s do restaurante %s: %s.",
                asset_type,
                rest_id,
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Não foi possível remover a imagem.",
            ) from exc

        if response.status_code not in {
            status.HTTP_200_OK,
            status.HTTP_204_NO_CONTENT,
            status.HTTP_404_NOT_FOUND,
        }:
            logger.warning(
                "Storage rejeitou remoção de %s do restaurante %s com HTTP %s.",
                asset_type,
                rest_id,
                response.status_code,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Não foi possível remover a imagem.",
            )

    if asset_type == "logo":
        restaurante.logo_url = None
        restaurante.cardapio_logo_path = None
    else:
        restaurante.banner_url = None
        restaurante.cardapio_banner_path = None
    db.commit()
    db.refresh(restaurante)
    notify_cardapio_config_update(background_tasks, rest_id)
    return restaurante


@router.put("/config", response_model=RestauranteConfigResponse)
@router.post("/config", response_model=RestauranteConfigResponse)
@router.put("/", response_model=RestauranteConfigResponse)
@router.post("/", response_model=RestauranteConfigResponse)
def atualizar_config_cardapio_digital(
    config_in: RestauranteConfigUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    """Atualiza e persiste as configurações whitelabel do tenant autenticado."""
    rest_id = (
        getattr(current_user, "restaurante_id", None)
        or getattr(current_user, "tenant_id", None)
        or current_restaurante_id.get()
    )
    if not rest_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Restaurante não identificado na sessão do usuário.",
        )

    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado para atualização.",
        )

    apply_restaurant_profile_update(restaurante, config_in)
    db.commit()
    db.refresh(restaurante)
    notify_cardapio_config_update(background_tasks, int(rest_id))
    return restaurante
