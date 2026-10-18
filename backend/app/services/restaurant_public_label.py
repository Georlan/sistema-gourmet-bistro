"""Public label for legacy stores whose registered name is the platform name.

No persisted/legal identity is changed. A specific registered name always wins;
the existing public menu slug is the only fallback for legacy platform names.
"""
import re
import unicodedata


def restaurant_public_label(restaurant) -> str:
    label = ' '.join(str(getattr(restaurant, 'nome', '') or '').split())
    normalized = unicodedata.normalize('NFKD', label).encode('ascii', 'ignore').decode().casefold()
    slug = str(getattr(restaurant, 'slug', '') or '').strip()
    if normalized in {'', 'koma'} and re.fullmatch(r'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*', slug):
        label = slug.replace('-', ' ').title()
    return re.sub(r'[*_~`\r\n]', '', label).strip()[:80] or 'Restaurante'
