"""Canonical Storage identity. Never accept an arbitrary client deletion path."""
import re
from urllib.parse import unquote, urlsplit
from ..config import settings


def storage_object_path(asset_url, restaurante_id, asset_type):
    if not isinstance(asset_url, str) or not asset_url or restaurante_id <= 0:
        return None
    value = asset_url
    if '://' in value:
        parsed = urlsplit(value)
        origin = urlsplit(settings.SUPABASE_URL)
        if parsed.scheme != origin.scheme or parsed.netloc != origin.netloc or parsed.fragment:
            return None
        marker = '/storage/v1/object/public/cardapio-assets/'
        if not parsed.path.startswith(marker):
            return None
        value = parsed.path[len(marker):]
    else:
        value = value.split('?', 1)[0].lstrip('/')
        value = value.removeprefix('cardapio-assets/')
    value = unquote(value)
    # Product UUIDs and historical flat filenames only; no nested paths or escapes.
    if asset_type == 'products':
        pattern = rf'{int(restaurante_id)}/products/[A-Za-z0-9][A-Za-z0-9_.-]*'
        if not re.fullmatch(pattern, value) or value.rsplit('/', 1)[-1] in {'.', '..'}:
            return None
    else:
        if not value.startswith(f'{restaurante_id}/{asset_type}/'):
            return None
        if any(part in {'', '.', '..'} for part in value.split('/')) or '\\' in value:
            return None
    return value


_BUCKET_MARKER = '/storage/v1/object/public/cardapio-assets/'
_RELATIVE_BUCKET_RE = re.compile(r'^(?P<tenant>\d+)/(?P<kind>products|logo|banner)/(?P<rest>.*)$')


def extract_bucket_object_path(asset_url: str | None) -> str | None:
    """Return the raw bucket path if asset_url targets cardapio-assets, else None."""
    if not isinstance(asset_url, str):
        return None
    raw = asset_url.strip()
    if not raw:
        return None
    unquoted = unquote(raw)
    if '://' in raw:
        parsed = urlsplit(raw)
        path_unquoted = unquote(parsed.path)
        idx = path_unquoted.find(_BUCKET_MARKER)
        if idx == -1:
            return None
        if parsed.fragment:
            return ''
        return path_unquoted[idx + len(_BUCKET_MARKER):]
    cleaned = unquoted.split('?', 1)[0].split('#', 1)[0].lstrip('/')
    if cleaned.startswith('cardapio-assets/'):
        return cleaned[len('cardapio-assets/'):]
    if _RELATIVE_BUCKET_RE.match(cleaned):
        return cleaned
    return None


def validate_tenant_storage_reference(
    asset_url: str | None,
    restaurante_id: int,
    asset_type: str,
) -> str | None:
    """Ensure cardapio-assets references belong to restaurante_id and asset_type."""
    if asset_url is None:
        return None
    if not isinstance(asset_url, str):
        raise ValueError('URL de imagem inválida.')
    cleaned = asset_url.strip()
    if not cleaned:
        return ''
    bucket_path = extract_bucket_object_path(cleaned)
    if bucket_path is None:
        return cleaned
    if not bucket_path or '\\' in bucket_path:
        raise ValueError('Caminho de imagem no armazenamento é inválido.')
    parts = bucket_path.split('/')
    if len(parts) != 3 or any(part in {'', '.', '..'} for part in parts):
        raise ValueError('Caminho de imagem no armazenamento é inválido.')
    tenant_part, kind_part, filename = parts
    if not tenant_part.isdigit() or int(tenant_part) != int(restaurante_id):
        raise ValueError('A imagem informada pertence a outro restaurante.')
    if kind_part != asset_type:
        raise ValueError(f'A imagem informada não pertence à categoria {asset_type}.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', filename) or filename in {'.', '..'}:
        raise ValueError('Nome de arquivo de imagem inválido.')
    return cleaned


def normalize_gallery_references(
    gallery: list[str] | None,
    restaurante_id: int,
    primary_image: str | None = None,
) -> list[str]:
    """Validate, strip, and deduplicate gallery URLs for a tenant product."""
    if not gallery:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in gallery:
        validated = validate_tenant_storage_reference(item, restaurante_id, 'products')
        if not validated or validated in seen:
            continue
        seen.add(validated)
        normalized.append(validated)
    return normalized

