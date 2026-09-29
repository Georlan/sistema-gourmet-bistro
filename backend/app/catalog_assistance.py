from __future__ import annotations

import datetime
import re
from pathlib import PurePath

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Table,
    Text,
)

from .database import Base, current_restaurante_id


MAX_CATALOG_SOURCE_SIZE = 10 * 1024 * 1024
CATALOG_ASSISTANCE_STATUSES = (
    "pending",
    "processing",
    "completed",
    "cancelled",
    "superseded",
)

catalog_assistance_requests = Table(
    "catalog_assistance_requests",
    Base.metadata,
    Column("id", String(36), primary_key=True),
    Column(
        "restaurante_id",
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    ),
    Column("original_filename", String(255), nullable=False),
    Column("content_type", String(100), nullable=False),
    Column("file_size", Integer, nullable=False),
    Column("file_sha256", String(64), nullable=False),
    Column("file_content", LargeBinary, nullable=False),
    Column("status", String(20), nullable=False, default="pending"),
    Column("operator_note", Text, nullable=True),
    Column(
        "created_at",
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    ),
    Column(
        "updated_at",
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    ),
    Column("completed_at", DateTime(timezone=True), nullable=True),
    CheckConstraint(
        "status IN ('pending', 'processing', 'completed', 'cancelled', 'superseded')",
        name="ck_catalog_assistance_requests_status",
    ),
    Index(
        "ix_catalog_assistance_tenant_status_created",
        "restaurante_id",
        "status",
        "created_at",
    ),
    extend_existing=True,
)


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def safe_catalog_filename(filename: str | None, content_type: str) -> str:
    raw = PurePath(filename or "cardapio").name
    raw = re.sub(r"[\x00-\x1f\x7f]+", "", raw).strip()
    if not raw:
        raw = "cardapio"

    canonical_extension = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/avif": ".avif",
        "image/heic": ".heic",
    }.get(content_type, "")
    path = PurePath(raw)
    stem = path.stem or "cardapio"
    extension = path.suffix.lower()
    accepted_extensions = {
        "application/pdf": {".pdf"},
        "image/png": {".png"},
        "image/jpeg": {".jpg", ".jpeg"},
        "image/webp": {".webp"},
        "image/gif": {".gif"},
        "image/bmp": {".bmp"},
        "image/avif": {".avif"},
        "image/heic": {".heic", ".heif"},
    }.get(content_type, set())
    if extension not in accepted_extensions:
        raw = f"{stem}{canonical_extension}"
    return raw[:255]


def detect_catalog_source_type(declared_type: str | None, content: bytes) -> str:
    normalized = (declared_type or "").split(";", 1)[0].strip().lower()
    aliases = {
        "image/jpg": "image/jpeg",
        "image/pjpeg": "image/jpeg",
        "image/x-png": "image/png",
        "image/heif": "image/heic",
        "application/x-pdf": "application/pdf",
        "binary/octet-stream": "application/octet-stream",
    }
    normalized = aliases.get(normalized, normalized)

    detected: str | None = None
    if content.startswith(b"%PDF-"):
        detected = "application/pdf"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = "image/png"
    elif content.startswith(b"\xff\xd8\xff"):
        detected = "image/jpeg"
    elif len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        detected = "image/webp"
    elif content.startswith((b"GIF87a", b"GIF89a")):
        detected = "image/gif"
    elif content.startswith(b"BM"):
        detected = "image/bmp"
    elif len(content) >= 12 and content[4:8] == b"ftyp":
        brand = content[8:12].lower()
        if brand in {b"avif", b"avis"}:
            detected = "image/avif"
        elif brand in {b"heic", b"heix", b"hevc", b"hevx", b"heif", b"mif1", b"msf1"}:
            detected = "image/heic"

    if detected is None:
        raise ValueError(
            "Formato inválido. Envie PDF ou uma imagem JPG, PNG, WEBP, GIF, BMP, AVIF ou HEIC."
        )

    generic_declared_types = {"", "application/octet-stream", "image/*"}
    if normalized not in generic_declared_types | {detected}:
        raise ValueError("O conteúdo do arquivo não corresponde ao formato informado.")
    return detected
