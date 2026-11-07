"""Bounded image normalization for public menu uploads; never touches existing objects."""
from dataclasses import dataclass
from io import BytesIO
import threading
import time
import warnings

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()

MAX_SOURCE_PIXELS = 24_000_000
# One decode/encode per backend process; uploads must not exhaust operational RAM.
_encoder_slot = threading.BoundedSemaphore(1)
_metrics_lock = threading.Lock()
_optimization_metrics: dict[str, dict[str, int | float]] = {}


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


def _record_metric(kind: str, input_bytes: int, output_bytes: int, duration_ms: float, passthrough: bool) -> None:
    saved = max(0, input_bytes - output_bytes)
    with _metrics_lock:
        bucket = _optimization_metrics.setdefault(
            kind,
            {
                'count': 0,
                'passthrough_count': 0,
                'input_bytes': 0,
                'output_bytes': 0,
                'saved_bytes': 0,
                'total_duration_ms': 0.0,
            },
        )
        bucket['count'] = int(bucket['count']) + 1
        if passthrough:
            bucket['passthrough_count'] = int(bucket['passthrough_count']) + 1
        bucket['input_bytes'] = int(bucket['input_bytes']) + int(input_bytes)
        bucket['output_bytes'] = int(bucket['output_bytes']) + int(output_bytes)
        bucket['saved_bytes'] = int(bucket['saved_bytes']) + int(saved)
        bucket['total_duration_ms'] = round(float(bucket['total_duration_ms']) + duration_ms, 3)


def get_optimization_metrics() -> dict[str, dict[str, int | float]]:
    with _metrics_lock:
        return {k: dict(v) for k, v in _optimization_metrics.items()}


def reset_optimization_metrics() -> None:
    with _metrics_lock:
        _optimization_metrics.clear()


def _encode(image: Image.Image, *, quality: int, lossless: bool = False) -> bytes:
    output = BytesIO()
    image.save(output, format='WEBP', quality=quality, lossless=lossless,
               method=4, exif=b'', icc_profile=b'', xmp=b'')
    return output.getvalue()


def _normalize_alpha(image: Image.Image) -> tuple[Image.Image, bool]:
    """Convert fully opaque RGBA images to RGB and zero hidden RGB noise under A=0."""
    alpha_channel = image.getchannel('A')
    min_alpha, max_alpha = alpha_channel.getextrema()
    if min_alpha == 255 and max_alpha == 255:
        return image.convert('RGB'), False
    if min_alpha == 0:
        mask = alpha_channel.point(lambda a: 255 if a else 0)
        blank = Image.new('RGBA', image.size, (0, 0, 0, 0))
        return Image.composite(image, blank, mask), True
    return image, True


def optimize_image(content: bytes, kind: str) -> OptimizedImage:
    started = time.perf_counter()
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
                orig_width, orig_height = source.size
                # Already-normalized WebP keeps its exact bytes and quality.
                if (source.format == 'WEBP' and len(content) <= budget.max_bytes
                        and max(source.size) <= budget.max_edge
                        and not any(source.info.get(key) for key in ('exif', 'icc_profile', 'xmp'))):
                    source.load()
                    result = OptimizedImage(content, *source.size)
                    _record_metric(kind, len(content), len(result.content), (time.perf_counter() - started) * 1000.0, True)
                    return result
                # Resize before copying/converting: keep peak memory bounded, including PNGs.
                source.thumbnail((budget.max_edge, budget.max_edge), Image.Resampling.LANCZOS)
                ImageOps.exif_transpose(source, in_place=True)
                image = source
                was_resized = image.size != (orig_width, orig_height)
                alpha = image.mode in ('RGBA', 'LA') or 'transparency' in image.info
                mode = 'RGBA' if alpha else 'RGB'
                profile = image.info.get('icc_profile')
                if profile:
                    image = ImageCms.profileToProfile(
                        image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                        ImageCms.createProfile('sRGB'), outputMode=mode,
                    )
                elif image.mode != mode:
                    image = image.convert(mode)
                if image.mode == 'RGBA':
                    image, alpha = _normalize_alpha(image)
                # No EXIF/GPS, XMP, source filenames or color profiles in public output.
                image.info.clear()
                # When converting an image already within dimension & byte limits, prefer a
                # quality step that also reduces byte size below the input file (down to 16 KiB floor).
                preferred_bytes = (
                    min(budget.max_bytes, max(16 * 1024, int(len(content) * 0.95)))
                    if not was_resized and len(content) < budget.max_bytes and kind != 'catalog_source'
                    else budget.max_bytes
                )
                first_scale_pass = True
                while True:
                    if kind == 'logo' and (alpha or max(image.size) <= 256):
                        encoded = _encode(image, quality=80, lossless=True)
                        if len(encoded) <= preferred_bytes:
                            result = OptimizedImage(encoded, *image.size)
                            _record_metric(kind, len(content), len(result.content), (time.perf_counter() - started) * 1000.0, False)
                            return result
                    qualities = (
                        (94, 92, 90)
                        if kind == 'catalog_source'
                        else ((90, 86, 82, 78) if kind == 'logo' else (86, 82, 78, 74))
                    )
                    best_within_budget: bytes | None = None
                    for quality in qualities:
                        encoded = _encode(image, quality=quality)
                        if len(encoded) <= preferred_bytes:
                            result = OptimizedImage(encoded, *image.size)
                            _record_metric(kind, len(content), len(result.content), (time.perf_counter() - started) * 1000.0, False)
                            return result
                        if len(encoded) <= budget.max_bytes and (
                            best_within_budget is None or len(encoded) < len(best_within_budget)
                        ):
                            best_within_budget = encoded
                    if first_scale_pass and best_within_budget is not None:
                        result = OptimizedImage(best_within_budget, *image.size)
                        _record_metric(kind, len(content), len(result.content), (time.perf_counter() - started) * 1000.0, False)
                        return result
                    first_scale_pass = False
                    preferred_bytes = budget.max_bytes
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
