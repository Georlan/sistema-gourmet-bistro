"""
Gerador de ficha promocional térmica para o Ceará Tech Summit 2026.
Gera raster ESC/POS monocromático (384 dots / 58 mm) com alto contraste,
quiet zone preservada e QR code de leitura instantânea por câmeras de celular.
"""

from __future__ import annotations

import os
import textwrap
from typing import Optional
from PIL import Image, ImageDraw, ImageFont

from . import qrcodegen

PAPER_WIDTH_DOTS = 384
DEFAULT_CANONICAL_URL = "https://komafood.com.br/cearatech?source=qr_impresso"

# Caminhos de fontes comuns no Linux / Debian / Ubuntu com fallback
FONT_CANDIDATES_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]
FONT_CANDIDATES_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
]


def _load_font(candidates: list[str], size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def generate_cearatech_promo_image(
    canonical_url: str = DEFAULT_CANONICAL_URL,
) -> Image.Image:
    """
    Gera uma imagem monocromática de 384 dots de largura com a ficha promocional do KÔMA.
    """
    font_brand = _load_font(FONT_CANDIDATES_BOLD, 36)
    font_subtitle = _load_font(FONT_CANDIDATES_BOLD, 15)
    font_h1 = _load_font(FONT_CANDIDATES_BOLD, 17)
    font_body = _load_font(FONT_CANDIDATES_REGULAR, 15)
    font_cta_bold = _load_font(FONT_CANDIDATES_BOLD, 15)
    font_cta_sub = _load_font(FONT_CANDIDATES_REGULAR, 13)
    font_meta = _load_font(FONT_CANDIDATES_REGULAR, 13)
    font_instagram = _load_font(FONT_CANDIDATES_BOLD, 16)

    # 1. Gerar QR Code canônico com quiet zone de 4 módulos
    qr = qrcodegen.QrCode.encode_text(canonical_url, qrcodegen.QrCode.Ecc.MEDIUM)
    qr_size = qr.get_size()
    scale = 8  # 8 dots por módulo para máxima nitidez em 384 dots
    quiet = 4  # 4 módulos de quiet zone padrão ISO
    qr_modules = qr_size + quiet * 2
    qr_pixel_size = qr_modules * scale  # ex: 37 * 8 = 296 dots

    # Criar canvas monocromático inicial (altura estimada; recortaremos ao final)
    max_height = 1200
    canvas = Image.new("1", (PAPER_WIDTH_DOTS, max_height), color=1)  # 1 = branco
    draw = ImageDraw.Draw(canvas)

    y = 20

    # Marca KÔMA
    draw.text((PAPER_WIDTH_DOTS / 2, y), "KÔMA", font=font_brand, fill=0, anchor="mt")
    y += 44

    # Subtítulo institucional
    draw.text((PAPER_WIDTH_DOTS / 2, y), "Gestão para restaurantes", font=font_subtitle, fill=0, anchor="mt")
    y += 24

    # Linha separadora
    draw.line([(24, y), (PAPER_WIDTH_DOTS - 24, y)], fill=0, width=2)
    y += 16

    # Chamada de encerramento
    draw.text((PAPER_WIDTH_DOTS / 2, y), "Gostou do que viu?", font=font_h1, fill=0, anchor="mt")
    y += 22
    draw.text((PAPER_WIDTH_DOTS / 2, y), "Conheça o KÔMA no seu restaurante.", font=font_body, fill=0, anchor="mt")
    y += 26

    # Desenhar QR Code centralizado
    qr_left = (PAPER_WIDTH_DOTS - qr_pixel_size) // 2
    for r in range(qr_size):
        for c in range(qr_size):
            if qr.get_module(c, r):
                x0 = qr_left + (c + quiet) * scale
                y0 = y + (r + quiet) * scale
                x1 = x0 + scale
                y1 = y0 + scale
                draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=0)

    y += qr_pixel_size + 14

    # CTA de captação
    draw.text((PAPER_WIDTH_DOTS / 2, y), "Escaneie e deixe seu WhatsApp.", font=font_cta_bold, fill=0, anchor="mt")
    y += 20
    draw.text((PAPER_WIDTH_DOTS / 2, y), "A gente fala com você após o Summit.", font=font_cta_sub, fill=0, anchor="mt")
    y += 24

    # Linha separadora
    draw.line([(24, y), (PAPER_WIDTH_DOTS - 24, y)], fill=0, width=2)
    y += 14

    # Instagram oficial
    draw.text((PAPER_WIDTH_DOTS / 2, y), "Instagram: @komafood", font=font_instagram, fill=0, anchor="mt")
    y += 22

    # Identificação do evento
    draw.text((PAPER_WIDTH_DOTS / 2, y), "Ceará Tech Summit 2026", font=font_meta, fill=0, anchor="mt")
    y += 30

    # Recortar imagem na altura final com margem inferior limpa
    final_height = y + 20
    final_image = canvas.crop((0, 0, PAPER_WIDTH_DOTS, final_height))
    return final_image


def image_to_escpos_raster(im: Image.Image, *, feed_lines: int = 4, cut: bool = True) -> bytes:
    """
    Converte uma PIL Image monocromática em comando ESC/POS raster ('GS v 0').
    Compatível com qualquer impressora térmica ESC/POS padrão de 58 mm / 80 mm.
    """
    mono = im.convert("1")
    width, height = mono.size
    bytes_per_row = (width + 7) // 8

    raster_bytes = bytearray()

    # 1. Reset / Inicializar impressora ESC @
    raster_bytes.extend(b"\x1b@")

    # 2. Comando GS v 0 0 xL xH yL yH
    header = bytes([
        0x1D, 0x76, 0x30, 0x00,
        bytes_per_row % 256, bytes_per_row // 256,
        height % 256, height // 256,
    ])
    raster_bytes.extend(header)

    pixels = mono.load()
    for y_idx in range(height):
        for byte_idx in range(bytes_per_row):
            byte_val = 0
            for bit in range(8):
                x_idx = byte_idx * 8 + bit
                if x_idx < width:
                    # No bitmap 1-bit: 0 = preto (queimar), 1 = branco (papel)
                    if pixels[x_idx, y_idx] == 0:
                        byte_val |= (1 << (7 - bit))
            raster_bytes.append(byte_val)

    # 3. Avanço de papel
    raster_bytes.extend(b"\n" * max(1, feed_lines))

    # 4. Corte de papel (GS V 66 0 = corte parcial)
    if cut:
        raster_bytes.extend(b"\x1d\x56\x42\x00")

    return bytes(raster_bytes)


def build_cearatech_promo_escpos(canonical_url: str = DEFAULT_CANONICAL_URL) -> bytes:
    """
    Atalho para gerar o payload ESC/POS binário completo pronto para envio à impressora.
    """
    img = generate_cearatech_promo_image(canonical_url)
    return image_to_escpos_raster(img)
