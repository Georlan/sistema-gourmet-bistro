from io import BytesIO
from unittest.mock import patch

import pytest
from PIL import Image

from app.services.image_optimization import (
    IMAGE_BUDGETS, ImageOptimizerBusy, InvalidImage, optimize_image,
)


def raster(size=(2400, 1600), mode='RGB', format='PNG', **kwargs):
    image = Image.new(mode, size, (12, 90, 160, 96) if mode == 'RGBA' else (12, 90, 160))
    output = BytesIO()
    image.save(output, format=format, **kwargs)
    return output.getvalue()


@pytest.mark.parametrize('kind', ['products', 'logo', 'banner'])
@pytest.mark.parametrize('format', ['PNG', 'JPEG', 'WEBP'])
def test_raster_is_bounded_static_webp_without_metadata(kind, format):
    result = optimize_image(raster(format=format), kind)
    budget = IMAGE_BUDGETS[kind]
    assert len(result.content) <= budget.max_bytes
    assert max(result.width, result.height) <= budget.max_edge
    assert result.width / result.height == pytest.approx(1.5, abs=.003)
    with Image.open(BytesIO(result.content)) as decoded:
        assert decoded.format == 'WEBP'
        assert decoded.size == (result.width, result.height)
        assert not decoded.getexif()
        assert not decoded.info.get('icc_profile')


def test_logo_preserves_transparency_and_does_not_upscale():
    result = optimize_image(raster((80, 50), 'RGBA'), 'logo')
    with Image.open(BytesIO(result.content)) as image:
        assert image.size == (80, 50)
        assert image.convert('RGBA').getpixel((0, 0)) == (12, 90, 160, 96)


def test_camera_orientation_is_applied_and_gps_removed():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = 'private camera metadata'
    result = optimize_image(raster((800, 400), format='JPEG', exif=exif), 'products')
    with Image.open(BytesIO(result.content)) as image:
        assert image.size == (400, 800)
        assert not image.getexif()


@pytest.mark.parametrize('content', [b'not an image', raster()[:40], raster()[:-20]])
def test_corrupt_image_rejected_and_encoder_slot_released(content):
    with pytest.raises(InvalidImage):
        optimize_image(content, 'products')
    assert optimize_image(raster((8, 8)), 'logo').width == 8


def test_pixel_limit_checked_before_decoding():
    content = raster((5000, 5000))
    with patch.object(Image.Image, 'load', side_effect=AssertionError('must not decode')):
        with pytest.raises(InvalidImage, match='24 megapixels'):
            optimize_image(content, 'products')


def test_animated_webp_rejected():
    output = BytesIO()
    Image.new('RGB', (20, 20), 'red').save(
        output, format='WEBP', save_all=True,
        append_images=[Image.new('RGB', (20, 20), 'blue')], duration=100, loop=0,
    )
    with pytest.raises(InvalidImage, match='estática'):
        optimize_image(output.getvalue(), 'products')


def test_concurrent_upload_fails_fast_without_waiting_or_encoding():
    from app.services.image_optimization import _encoder_slot
    with _encoder_slot:
        with pytest.raises(ImageOptimizerBusy):
            optimize_image(raster((8, 8)), 'logo')
    assert optimize_image(raster((8, 8)), 'logo').width == 8


def test_bad_color_profile_is_a_validation_error():
    with pytest.raises(InvalidImage):
        optimize_image(raster(icc_profile=b'invalid profile'), 'products')


@pytest.mark.parametrize('format', ['BMP', 'GIF', 'AVIF', 'HEIF'])
def test_assistance_photo_formats_are_normalized_with_legible_resolution(format):
    result = optimize_image(raster((2800, 1800), format=format), 'catalog_source')
    assert max(result.width, result.height) == 2560
    assert len(result.content) <= 1024 * 1024
    with Image.open(BytesIO(result.content)) as image:
        assert image.format == 'WEBP'


def test_already_optimized_small_webp_keeps_exact_size_and_quality():
    first = optimize_image(raster((320, 200)), 'products')
    second = optimize_image(first.content, 'products')
    assert second == first
