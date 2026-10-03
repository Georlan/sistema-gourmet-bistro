"""Bounded image normalization for public menu uploads; never touches existing objects."""
from dataclasses import dataclass
from io import BytesIO
import threading
import warnings

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()

MAX_SOURCE_PIXELS = 24_000_000
# One decode/encode per backend process; uploads must not exhaust operational RAM.
_encoder_slot = threading.BoundedSemaphore(1)


class InvalidImage(ValueError):
    pass


class ImageOptimizerBusy(RuntimeError):
    pass


@dataclass(frozen=True)
class ImageBudget:
    max_edge: int
    max_bytes: int
    min_edge: int


# Product detail is at most 512 CSS px; 1280 covers high-density displays.
# The banner spans the public content area; logos render much smaller.
IMAGE_BUDGETS = {
    'products': ImageBudget(1280, 200 * 1024, 640),
    'banner': ImageBudget(1920, 350 * 1024, 960),
    'logo': ImageBudget(512, 100 * 1024, 256),
    # Menu scans need larger text for assisted catalog transcription.
    'catalog_source': ImageBudget(2560, 1024 * 1024, 1920),
}


@dataclass(frozen=True)
class OptimizedImage:
    content: bytes
    width: int
    height: int
    content_type: str = 'image/webp'
    extension: str = 'webp'


def _encode(image: Image.Image, *, quality: int, lossless: bool = False) -> bytes:
    output = BytesIO()
    image.save(output, format='WEBP', quality=quality, lossless=lossless,
               method=4, exif=b'', icc_profile=b'', xmp=b'')
    return output.getvalue()


def optimize_image(content: bytes, kind: str) -> OptimizedImage:
    budget = IMAGE_BUDGETS[kind]
    formats = ['PNG', 'JPEG', 'WEBP']
    if kind == 'catalog_source':
        formats += ['GIF', 'BMP', 'AVIF', 'HEIF']
    if not _encoder_slot.acquire(blocking=False):
        raise ImageOptimizerBusy('Outra imagem está sendo preparada. Tente novamente em alguns segundos.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(content), formats=formats) as source:
                if source.width * source.height > MAX_SOURCE_PIXELS:
                    raise InvalidImage('A imagem excede o limite de 24 megapixels. Reduza suas dimensões.')
                if getattr(source, 'n_frames', 1) != 1:
                    raise InvalidImage('Use uma imagem estática, sem animação.')
                source.verify()
            with Image.open(BytesIO(content), formats=formats) as source:
                # Already-normalized WebP keeps its exact bytes and quality.
                if (source.format == 'WEBP' and len(content) <= budget.max_bytes
                        and max(source.size) <= budget.max_edge
                        and not any(source.info.get(key) for key in ('exif', 'icc_profile', 'xmp'))):
                    source.load()
                    return OptimizedImage(content, *source.size)
                # Resize before copying/converting: keep peak memory bounded, including PNGs.
                source.thumbnail((budget.max_edge, budget.max_edge), Image.Resampling.LANCZOS)
                image = ImageOps.exif_transpose(source)
                alpha = image.mode in ('RGBA', 'LA') or 'transparency' in image.info
                mode = 'RGBA' if alpha else 'RGB'
                profile = image.info.get('icc_profile')
                if profile:
                    image = ImageCms.profileToProfile(
                        image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                        ImageCms.createProfile('sRGB'), outputMode=mode,
                    )
                else:
                    image = image.convert(mode)
                # No EXIF/GPS, XMP, source filenames or color profiles in public output.
                image.info.clear()
                while True:
                    if kind == 'logo':
                        encoded = _encode(image, quality=80, lossless=True)
                        if len(encoded) <= budget.max_bytes:
                            return OptimizedImage(encoded, *image.size)
                    qualities = (94, 92, 90) if kind == 'catalog_source' else ((90, 86, 82) if kind == 'logo' else (86, 82, 78))
                    for quality in qualities:
                        encoded = _encode(image, quality=quality)
                        if len(encoded) <= budget.max_bytes:
                            return OptimizedImage(encoded, *image.size)
                    edge = max(image.size)
                    if edge <= budget.min_edge:
                        raise InvalidImage('A imagem é muito complexa para o limite de publicação. Escolha outra foto.')
                    next_edge = max(budget.min_edge, int(edge * 0.8))
                    image.thumbnail((next_edge, next_edge), Image.Resampling.LANCZOS)
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, ImageCms.PyCMSError,
            Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        if isinstance(exc, InvalidImage):
            raise
        raise InvalidImage('Não foi possível ler a imagem. Envie um PNG, JPG ou WebP válido.') from exc
    finally:
        _encoder_slot.release()
