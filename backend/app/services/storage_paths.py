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
