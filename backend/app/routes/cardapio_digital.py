import os
import uuid
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from ..database import get_db, require_tenant_id
from ..models import Restaurante, Usuario
from ..routes.auth import get_current_user
from ..schemas import RestauranteConfigResponse

logger = logging.getLogger("koma.cardapio_digital")
router = APIRouter(prefix="/api/cardapio-digital", tags=["Cardapio Digital Assets"])

ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


def get_supabase_config():
    supabase_url = os.getenv("SUPABASE_URL", "https://iiowhekvahxiepwcdidm.supabase.co").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
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
        "Authorization": f"Bearer {service_key}" if service_key else "",
        "apikey": service_key,
        "Content-Type": file.content_type or f"image/{ext}",
        "x-upsert": "true"
    }

    storage_upload_url = f"{supabase_url}/storage/v1/object/cardapio-assets/{relative_path}"
    old_path = restaurante.cardapio_logo_path if asset_type == "logo" else restaurante.cardapio_banner_path

    # Step 1: Upload new file to Supabase Storage
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(storage_upload_url, headers=headers, content=content)
            if res.status_code not in (200, 201):
                logger.error(f"Erro ao enviar arquivo para Supabase Storage: status={res.status_code}, response={res.text}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Falha ao salvar o arquivo no servidor de armazenamento."
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro de rede ao conectar ao Supabase Storage")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro de comunicação ao enviar imagem para o storage."
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
        logger.exception("Erro ao persistir caminho do asset no banco. Upload cancelado.")
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
            logger.warning(f"Não foi possível remover o arquivo antigo {old_path} do Storage: {e}")

    return restaurante


@router.post("/assets/logo", response_model=RestauranteConfigResponse)
async def upload_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    return await upload_asset_to_supabase("logo", file, db, current_user)


@router.post("/assets/banner", response_model=RestauranteConfigResponse)
async def upload_banner(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    return await upload_asset_to_supabase("banner", file, db, current_user)


@router.delete("/assets/logo", response_model=RestauranteConfigResponse)
async def delete_logo(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
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
            "Authorization": f"Bearer {service_key}" if service_key else "",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{supabase_url}/storage/v1/object/cardapio-assets"
                await client.request("DELETE", del_url, headers=headers, json={"prefixes": [old_path]})
        except Exception as e:
            logger.warning(f"Erro ao remover logo {old_path} do Storage: {e}")

    return restaurante


@router.delete("/assets/banner", response_model=RestauranteConfigResponse)
async def delete_banner(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
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
            "Authorization": f"Bearer {service_key}" if service_key else "",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{supabase_url}/storage/v1/object/cardapio-assets"
                await client.request("DELETE", del_url, headers=headers, json={"prefixes": [old_path]})
        except Exception as e:
            logger.warning(f"Erro ao remover banner {old_path} do Storage: {e}")

    return restaurante
