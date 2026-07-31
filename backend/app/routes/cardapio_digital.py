from contextlib import contextmanager
import logging
from typing import Optional
from urllib.parse import quote, unquote
import uuid

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from ..config import settings
from ..database import (
    bind_session_to_tenant,
    current_restaurante_id,
    get_db,
    require_tenant_id,
)
from ..models import Restaurante, Usuario, Categoria, Produto
from ..security import require_permission, get_current_garcom_optional
from ..schemas import (
    CardapioPublicRestaurantResponse,
    CardapioPublicResponse,
    RestauranteConfigResponse,
    RestauranteConfigUpdate,
)

logger = logging.getLogger("koma.cardapio_digital")
router = APIRouter(prefix="/api/cardapio-digital", tags=["Cardapio Digital Assets"])

MAX_ASSET_SIZE = 5 * 1024 * 1024
ALLOWED_ASSET_TYPES = {
    "image/png": ("png", b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": ("jpg", b"\xff\xd8\xff"),
    "image/webp": ("webp", b"RIFF"),
}


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


def _storage_object_path(
    asset_url: Optional[str],
    restaurante_id: int,
    asset_type: str,
) -> Optional[str]:
    if not asset_url:
        return None
    marker = "/storage/v1/object/public/cardapio-assets/"
    if marker in asset_url:
        clean_path = asset_url.split(marker, 1)[1].split("?", 1)[0]
    else:
        clean_path = asset_url.lstrip("/")
    if clean_path.startswith("cardapio-assets/"):
        clean_path = clean_path.removeprefix("cardapio-assets/")

    clean_path = unquote(clean_path)
    expected_prefix = f"{restaurante_id}/{asset_type}/"
    if not clean_path.startswith(expected_prefix):
        return None
    if any(part in {"", ".", ".."} for part in clean_path.split("/")):
        return None
    return clean_path


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
    return headers


def resolve_restaurant_id(
    restaurante_id: Optional[str],
    slug: Optional[str],
    db: Session,
    current_user: Optional[Usuario] = None,
) -> int:
    """
    Resolve um identificador público sem consultar tabelas tenant via ORM.

    No PostgreSQL, a função SECURITY DEFINER é a única operação autorizada antes
    de a sessão receber o tenant. Depois da resolução, a transação sentinela é
    descartada e toda consulta seguinte recebe ``app.current_restaurante_id``.
    """
    restaurant_identifier = (
        str(restaurante_id).strip() if restaurante_id is not None else ""
    )
    slug_identifier = str(slug).strip() if slug is not None else ""
    identifier = restaurant_identifier or slug_identifier

    if identifier:
        if len(identifier) > 128:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Identificador de restaurante inválido.",
            )

        if db.get_bind().dialect.name == "postgresql":
            resolved_id = db.execute(
                text(
                    "SELECT id "
                    "FROM koma_internal.resolve_public_restaurant(:identifier)"
                ),
                {"identifier": identifier},
            ).scalar_one_or_none()
        else:
            # Compatibilidade com SQLite nos testes locais. SQL textual evita
            # que um contexto anterior altere a resolução do identificador.
            resolved_id = db.execute(
                text(
                    """
                    SELECT id
                    FROM restaurantes
                    WHERE CAST(id AS TEXT) = :identifier
                       OR lower(COALESCE(slug, '')) = lower(:identifier)
                    ORDER BY CASE
                        WHEN CAST(id AS TEXT) = :identifier THEN 0
                        ELSE 1
                    END
                    LIMIT 1
                    """
                ),
                {"identifier": identifier},
            ).scalar_one_or_none()

        if resolved_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Restaurante não encontrado.",
            )

        rest_id = int(resolved_id)
    else:
        rest_id = current_restaurante_id.get()
        if rest_id is None and current_user is not None:
            rest_id = (
                getattr(current_user, "tenant_id", None)
                or getattr(current_user, "restaurante_id", None)
            )

        if not isinstance(rest_id, int) or isinstance(rest_id, bool) or rest_id <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Identificador de restaurante é obrigatório.",
            )

    bind_session_to_tenant(db, rest_id)
    return rest_id


@contextmanager
def public_tenant_scope(
    restaurante_id: Optional[str],
    slug: Optional[str],
    db: Session,
    current_user: Optional[Usuario] = None,
):
    """Mantém ORM e RLS vinculados ao mesmo tenant durante a operação pública."""
    rest_id = resolve_restaurant_id(restaurante_id, slug, db, current_user)
    token = current_restaurante_id.set(rest_id)
    try:
        yield rest_id
    finally:
        current_restaurante_id.reset(token)


def _ordered_categories(categories: list[Categoria]) -> list[Categoria]:
    order_list = [
        "Hambúrgueres Bovinos", "Hambúrgueres de Frango", "Hambúrgueres Suínos",
        "Baguetes", "Pastéis Tradicionais", "Pastelões Especiais", "Pastéis Doces",
        "Petiscos", "Combos Promocionais", "Sucos", "Refrigerantes e Águas",
        "Cervejas", "Bebidas Quentes",
    ]
    order_index = {name: index for index, name in enumerate(order_list)}
    return sorted(
        categories,
        key=lambda category: order_index.get(category.nome, len(order_list)),
    )


def _public_restaurant_payload(restaurante: Restaurante) -> dict:
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
        "socials": restaurante.socials,
        "horarios_funcionamento": restaurante.horarios_funcionamento,
        "formas_pagamento_aceitas": restaurante.formas_pagamento_aceitas,
        "cor_primaria": restaurante.cor_primaria,
        "cor_fundo": restaurante.cor_fundo,
    }


def _public_category_payload(category: Categoria) -> dict:
    return {"id": category.id, "nome": category.nome}


def _public_product_payload(product: Produto) -> dict:
    return {
        "id": product.id,
        "nome": product.nome,
        "descricao": product.descricao or "",
        "preco": float(product.preco) if product.preco is not None else 0.0,
        "imagem_url": product.imagem or "",
        "imagens_galeria": product.imagens_galeria or [],
        "categoria_id": product.categoria_id,
    }


@router.get("/config", response_model=CardapioPublicRestaurantResponse)
@router.get("/", response_model=CardapioPublicRestaurantResponse)
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
    with public_tenant_scope(
        restaurante_id, slug, db, current_user
    ) as rest_id:
        restaurante = db.query(Restaurante).filter(
            Restaurante.id == rest_id
        ).first()
        if not restaurante:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Restaurante não encontrado.",
            )
        return _public_restaurant_payload(restaurante)


@router.get("/categorias")
def obter_categorias_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna as categorias ativas do restaurante especificado para o cardápio digital (isolamento multi-tenant)."""
    with public_tenant_scope(restaurante_id, slug, db) as rest_id:
        categorias = db.query(Categoria).filter(
            Categoria.restaurante_id == rest_id
        ).all()
        return [
            _public_category_payload(category)
            for category in _ordered_categories(categorias)
        ]


@router.get("/produtos")
def obter_produtos_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna os produtos ativos do restaurante especificado para o cardápio digital (isolamento multi-tenant)."""
    with public_tenant_scope(restaurante_id, slug, db) as rest_id:
        produtos = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.ativo.is_(True),
        ).all()
        return [
            {**_public_product_payload(product), "ativo": True}
            for product in produtos
        ]


@router.get("/public", response_model=CardapioPublicResponse)
def obter_cardapio_publico(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_current_garcom_optional),
):
    """Retorna apenas os dados necessários ao cardápio público em um tenant."""
    with public_tenant_scope(
        restaurante_id, slug, db, current_user
    ) as rest_id:
        restaurante = db.query(Restaurante).filter(
            Restaurante.id == rest_id
        ).first()
        if not restaurante:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Restaurante não encontrado.",
            )

        categorias = db.query(Categoria).filter(
            Categoria.restaurante_id == rest_id
        ).all()
        produtos = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.ativo.is_(True),
        ).all()

        return {
            "restaurante": _public_restaurant_payload(restaurante),
            "categorias": [
                _public_category_payload(category)
                for category in _ordered_categories(categorias)
            ],
            "produtos": [
                _public_product_payload(product) for product in produtos
            ],
        }


@router.post(
    "/assets/{asset_type}",
    response_model=RestauranteConfigResponse,
)
async def upload_cardapio_asset(
    asset_type: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_permission("configuracoes:administrar")
    ),
):
    """Envia logo/banner validado ao bucket e salva somente no tenant autenticado."""
    del current_user
    if asset_type not in {"logo", "banner"}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de imagem não encontrado.",
        )

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
    restaurante = db.query(Restaurante).filter(
        Restaurante.id == rest_id
    ).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado.",
        )

    object_path = f"{rest_id}/{asset_type}/{uuid.uuid4().hex}.{extension}"
    storage_url = settings.SUPABASE_URL.rstrip("/")
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
            "Falha de rede ao enviar %s do restaurante %s: %s",
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
    if asset_type == "logo":
        restaurante.logo_url = public_url
        restaurante.cardapio_logo_path = object_path
    else:
        restaurante.banner_url = public_url
        restaurante.cardapio_banner_path = object_path

    db.commit()
    db.refresh(restaurante)
    return restaurante


@router.delete(
    "/assets/{asset_type}",
    response_model=RestauranteConfigResponse,
)
async def delete_cardapio_asset(
    asset_type: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_permission("configuracoes:administrar")
    ),
):
    """Remove logo/banner apenas do tenant autenticado."""
    del current_user
    if asset_type not in {"logo", "banner"}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de imagem não encontrado.",
        )

    rest_id = require_tenant_id()
    restaurante = db.query(Restaurante).filter(
        Restaurante.id == rest_id
    ).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado.",
        )

    current_url = (
        (restaurante.logo_url or restaurante.cardapio_logo_path)
        if asset_type == "logo"
        else (restaurante.banner_url or restaurante.cardapio_banner_path)
    )
    object_path = _storage_object_path(
        current_url,
        rest_id,
        asset_type,
    )
    if object_path:
        delete_url = (
            f"{settings.SUPABASE_URL.rstrip('/')}"
            "/storage/v1/object/cardapio-assets"
        )
        try:
            async with httpx.AsyncClient(
                timeout=20.0,
                trust_env=False,
            ) as client:
                response = await client.request(
                    "DELETE",
                    delete_url,
                    headers=_supabase_storage_headers(),
                    json={"prefixes": [object_path]},
                )
        except httpx.HTTPError as exc:
            logger.warning(
                "Falha de rede ao remover %s do restaurante %s: %s",
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
    return restaurante


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
