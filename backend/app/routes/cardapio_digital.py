import os
import uuid
import httpx
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from ..config import settings
from ..database import get_db, require_tenant_id, current_restaurante_id
from ..models import Restaurante, Usuario
from ..security import require_permission, get_current_garcom_optional
from ..schemas import RestauranteConfigResponse, RestauranteConfigUpdate

logger = logging.getLogger("koma.cardapio_digital")
router = APIRouter(prefix="/api/cardapio-digital", tags=["Cardapio Digital Assets"])

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
    Filtra por restaurante_id (int ou string), slug, tenant do usuário logado ou fallback 1.
    """
    rest_id = None
    if restaurante_id:
        if str(restaurante_id).isdigit():
            rest_id = int(restaurante_id)
        elif not slug:
            slug = str(restaurante_id)
            
    if not rest_id and not slug:
        rest_id = current_restaurante_id.get() or (current_user.tenant_id if current_user else None)
    
    restaurante = None
    if slug:
        restaurante = db.query(Restaurante).filter(Restaurante.slug == slug).first()
    if not restaurante and rest_id:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 1).first()
    if not restaurante:
        restaurante = db.query(Restaurante).first()
        
    if not restaurante:
        rest_id = rest_id or 1
        return RestauranteConfigResponse(
            id=rest_id,
            nome="Kôma Gourmet Bistrô",
            subtitulo="Sincronizado com o Sistema Kôma PDV",
            status_override="Automático",
            cor_primaria="#00b894",
            cor_fundo="#090a0f"
        )

    return restaurante


from ..models import Categoria, Produto

@router.get("/categorias")
def obter_categorias_cardapio_digital(
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retorna as categorias ativas do restaurante especificado para o cardápio digital (isolamento multi-tenant)."""
    rest_id = 1
    if restaurante_id:
        if str(restaurante_id).isdigit():
            rest_id = int(restaurante_id)
        elif not slug:
            slug = str(restaurante_id)

    if slug:
        rest = db.query(Restaurante).filter(Restaurante.slug == slug).first()
        if rest:
            rest_id = rest.id

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
    rest_id = 1
    if restaurante_id:
        if str(restaurante_id).isdigit():
            rest_id = int(restaurante_id)
        elif not slug:
            slug = str(restaurante_id)

    if slug:
        rest = db.query(Restaurante).filter(Restaurante.slug == slug).first()
        if rest:
            rest_id = rest.id

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
            "imagem_url": p.imagem_url or "",
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
    Filtra pelo restaurante_id / tenant atual e salva com db.commit().
    """
    rest_id = require_tenant_id() or getattr(current_user, "tenant_id", None) or getattr(current_user, "restaurante_id", None) or 1
    
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        restaurante = Restaurante(
            id=rest_id,
            nome="Kôma Gourmet Bistrô",
            plano="pocket",
            status_override="Automático",
            cor_primaria="#00b894",
            cor_fundo="#090a0f"
        )
        db.add(restaurante)

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
    if config_in.status_override is not None:
        restaurante.status_override = config_in.status_override
    if config_in.socials is not None:
        restaurante.socials = config_in.socials
    if config_in.horarios_funcionamento is not None:
        restaurante.horarios_funcionamento = config_in.horarios_funcionamento
    if config_in.formas_pagamento_aceitas is not None:
        restaurante.formas_pagamento_aceitas = config_in.formas_pagamento_aceitas
    if config_in.cor_primaria is not None:
        restaurante.cor_primaria = config_in.cor_primaria
    if config_in.cor_fundo is not None:
        restaurante.cor_fundo = config_in.cor_fundo

    db.commit()
    db.refresh(restaurante)
    return restaurante

ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


def get_supabase_config():
    supabase_url = (settings.SUPABASE_URL or os.getenv("SUPABASE_URL", "")).rstrip("/")
    service_key = settings.SUPABASE_SERVICE_ROLE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url:
        logger.error("[CARDAPIO ASSETS ERROR] SUPABASE_URL ausente nas variáveis de ambiente.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Servidor de armazenamento não configurado corretamente."
        )

    if not service_key:
        logger.error("[CARDAPIO ASSETS ERROR] SUPABASE_SERVICE_ROLE_KEY ausente nas variáveis de ambiente.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Servidor de armazenamento não autenticado."
        )

    if service_key.startswith("sb_publishable_"):
        logger.error("[CARDAPIO ASSETS ERROR] SUPABASE_SERVICE_ROLE_KEY é uma chave anon/publishable pública.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Credencial de armazenamento do servidor é inválida."
        )

    return supabase_url, service_key


def validate_image_file(file: UploadFile, content: bytes) -> str:
    if not content or len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo enviado está vazio."
        )

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo excede o limite máximo permitido de 5 MB."
        )

    # Content magic byte header inspection
    is_png = content.startswith(b"\x89PNG\r\n\x1a\n")
    is_jpeg = content.startswith(b"\xff\xd8\xff")
    is_webp = content.startswith(b"RIFF") and b"WEBP" in content[8:16]

    if not (is_png or is_jpeg or is_webp):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de arquivo inválido. Apenas imagens PNG, JPEG e WEBP são aceitas."
        )

    if is_png:
        return "png"
    elif is_jpeg:
        return "jpg"
    else:
        return "webp"


async def ensure_bucket_exists(supabase_url: str, service_key: str):
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": "application/json"
    }
    bucket_url = f"{supabase_url}/storage/v1/bucket"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                bucket_url,
                headers=headers,
                json={
                    "id": "cardapio-assets",
                    "name": "cardapio-assets",
                    "public": True,
                    "file_size_limit": 5242880,
                    "allowed_mime_types": ["image/png", "image/jpeg", "image/jpg", "image/webp"]
                }
            )
            logger.info(f"[CARDAPIO ASSETS] Bucket ensure status={res.status_code}")
    except Exception as e:
        logger.warning(f"[CARDAPIO ASSETS WARNING] Não foi possível verificar bucket via API: {e}")


async def upload_asset_to_supabase(asset_type: str, file: UploadFile, db: Session, current_user: Usuario):
    # Require tenant ID strictly from authenticated JWT context
    rest_id = require_tenant_id()
    if not rest_id or rest_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identificação do restaurante inválida no token de acesso."
        )

    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado."
        )

    content = await file.read()
    ext = validate_image_file(file, content)

    # Secure random filename to prevent path traversal
    secure_filename = f"{uuid.uuid4().hex}.{ext}"
    relative_path = f"{rest_id}/{asset_type}/{secure_filename}"

    supabase_url, service_key = get_supabase_config()
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": file.content_type or f"image/{ext}",
        "x-upsert": "true"
    }

    storage_upload_url = f"{supabase_url}/storage/v1/object/cardapio-assets/{relative_path}"
    old_path = restaurante.cardapio_logo_path if asset_type == "logo" else restaurante.cardapio_banner_path

    # Step 1: Upload new file to Supabase Storage
    try:
        await ensure_bucket_exists(supabase_url, service_key)
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(storage_upload_url, headers=headers, content=content)
            
            logger.info(
                f"[CARDAPIO ASSETS] Upload attempt -> asset_type={asset_type}, path={relative_path}, "
                f"status={res.status_code}, response={res.text[:300]}"
            )

            if res.status_code not in (200, 201):
                logger.error(
                    f"[CARDAPIO ASSETS ERROR] Supabase storage upload failed -> asset_type={asset_type}, "
                    f"path={relative_path}, status={res.status_code}, response={res.text}"
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Falha ao salvar no armazenamento (Supabase HTTP {res.status_code}): {res.text[:120]}"
                )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        tb_str = traceback.format_exc()
        logger.error(f"[CARDAPIO ASSETS TRACEBACK] Exceção durante upload para {relative_path}:\n{tb_str}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro no servidor ao processar imagem: {str(e)}"
        )

    # Step 2: Update Database
    try:
        public_url = f"{supabase_url}/storage/v1/object/public/cardapio-assets/{relative_path}"
        if asset_type == "logo":
            restaurante.cardapio_logo_path = relative_path
            restaurante.logo_url = public_url
        else:
            restaurante.cardapio_banner_path = relative_path
            restaurante.banner_url = public_url

        db.commit()
        db.refresh(restaurante)
    except Exception as e:
        db.rollback()
        # Rollback: Clean up newly uploaded orphan file from Storage if DB commit fails
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{supabase_url}/storage/v1/object/cardapio-assets"
                await client.request("DELETE", del_url, headers=headers, json={"prefixes": [relative_path]})
        except Exception:
            pass
        logger.exception(f"[CARDAPIO ASSETS DB ERROR] Erro ao salvar referência no banco para {relative_path}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao salvar a configuração no banco de dados."
        )

    # Step 3: Delete old file ONLY after successful DB commit
    if old_path and old_path != relative_path:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{supabase_url}/storage/v1/object/cardapio-assets"
                await client.request("DELETE", del_url, headers=headers, json={"prefixes": [old_path]})
        except Exception as e:
            logger.warning(f"[CARDAPIO ASSETS WARNING] Não foi possível remover arquivo antigo {old_path}: {e}")

    return restaurante


@router.post("/assets/logo", response_model=RestauranteConfigResponse)
async def upload_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    return await upload_asset_to_supabase("logo", file, db, current_user)


@router.post("/assets/banner", response_model=RestauranteConfigResponse)
async def upload_banner(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    return await upload_asset_to_supabase("banner", file, db, current_user)


@router.delete("/assets/logo", response_model=RestauranteConfigResponse)
async def delete_logo(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    rest_id = require_tenant_id()
    if not rest_id or rest_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identificação do restaurante inválida no token de acesso."
        )

    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Restaurante não encontrado.")

    old_path = restaurante.cardapio_logo_path
    restaurante.cardapio_logo_path = None
    restaurante.logo_url = None
    db.commit()
    db.refresh(restaurante)

    if old_path:
        supabase_url, service_key = get_supabase_config()
        headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{supabase_url}/storage/v1/object/cardapio-assets"
                await client.request("DELETE", del_url, headers=headers, json={"prefixes": [old_path]})
        except Exception as e:
            logger.warning(f"[CARDAPIO ASSETS WARNING] Erro ao remover logo {old_path} do Storage: {e}")

    return restaurante


@router.delete("/assets/banner", response_model=RestauranteConfigResponse)
async def delete_banner(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("catalogo:administrar"))
):
    rest_id = require_tenant_id()
    if not rest_id or rest_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identificação do restaurante inválida no token de acesso."
        )

    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Restaurante não encontrado.")

    old_path = restaurante.cardapio_banner_path
    restaurante.cardapio_banner_path = None
    restaurante.banner_url = None
    db.commit()
    db.refresh(restaurante)

    if old_path:
        supabase_url, service_key = get_supabase_config()
        headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{supabase_url}/storage/v1/object/cardapio-assets"
                await client.request("DELETE", del_url, headers=headers, json={"prefixes": [old_path]})
        except Exception as e:
            logger.warning(f"[CARDAPIO ASSETS WARNING] Erro ao remover banner {old_path} do Storage: {e}")

    return restaurante
