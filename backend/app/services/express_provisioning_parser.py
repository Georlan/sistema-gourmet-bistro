"""Parser determinístico para provisionamento expresso por texto ou JSON estruturado."""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from .universal_presets import infer_category_print_destination, slugify_category_id, slugify_restaurant_name

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_SUPPORTED_PLANS = {"pocket", "pro", "black"}

_PROFILE_KEYWORDS: tuple[tuple[str, str, str], ...] = (
    ("pizz", "pizzaria", "pizzaria"),
    ("marmit", "marmitaria", "marmitaria"),
    ("quentinha", "marmitaria", "marmitaria"),
    ("prato feito", "marmitaria", "marmitaria"),
    ("pf", "marmitaria", "marmitaria"),
    ("acai", "acai", "acaiteria"),
    ("sorvet", "acai", "acaiteria"),
    ("churras", "churrasco", "restaurante"),
    ("espet", "churrasco", "restaurante"),
    ("hamburg", "generic", "hamburgueria"),
    ("burger", "generic", "hamburgueria"),
    ("lanch", "generic", "hamburgueria"),
    ("pastel", "generic", "pastelaria"),
    ("restaurante", "generic", "restaurante"),
    ("bistro", "generic", "restaurante"),
)

_DAY_TOKEN_NORMALIZATION: tuple[tuple[str, str], ...] = (
    ("todos os dias", "Todos os dias"),
    ("todo dia", "Todos os dias"),
    ("diariamente", "Todos os dias"),
    ("segunda a domingo", "Segunda a Domingo"),
    ("seg a dom", "Segunda a Domingo"),
    ("segunda a sabado", "Segunda a Sábado"),
    ("seg a sab", "Segunda a Sábado"),
    ("segunda a sexta", "Segunda a Sexta"),
    ("seg a sex", "Segunda a Sexta"),
    ("segunda a quinta", "Segunda a Quinta"),
    ("seg a qui", "Segunda a Quinta"),
    ("quarta a domingo", "Quarta a Domingo"),
    ("qua a dom", "Quarta a Domingo"),
    ("quinta a domingo", "Quinta a Domingo"),
    ("qui a dom", "Quinta a Domingo"),
    ("sexta a domingo", "Sexta a Domingo"),
    ("sex a dom", "Sexta a Domingo"),
    ("sexta e sabado", "Sexta e Sábado"),
    ("sabado e domingo", "Sábado e Domingo"),
    ("sab e dom", "Sábado e Domingo"),
    ("fim de semana", "Sábado e Domingo"),
)

_KEY_ALIASES: dict[str, str] = {
    "nome": "name",
    "restaurante": "name",
    "nome do restaurante": "name",
    "estabelecimento": "name",
    "loja": "name",
    "slug": "slug",
    "subdominio": "slug",
    "segmento": "segment",
    "tipo": "segment",
    "perfil": "segment",
    "tipo de operacao": "segment",
    "categoria do negocio": "segment",
    "responsavel": "admin_name",
    "administrador": "admin_name",
    "admin": "admin_name",
    "dono": "admin_name",
    "proprietario": "admin_name",
    "seu nome": "admin_name",
    "contato": "admin_name",
    "email": "admin_email",
    "e mail": "admin_email",
    "email admin": "admin_email",
    "email do administrador": "admin_email",
    "whatsapp": "phone",
    "telefone": "phone",
    "celular": "phone",
    "fone": "phone",
    "endereco": "address",
    "local": "address",
    "logradouro": "address",
    "atendimento": "order_types",
    "modalidades": "order_types",
    "modalidade": "order_types",
    "tipos de pedido": "order_types",
    "horario": "operating_hours",
    "horarios": "operating_hours",
    "horario de funcionamento": "operating_hours",
    "funcionamento": "operating_hours",
    "plano": "plan",
    "plan": "plan",
    "cardapio": "menu",
    "menu": "menu",
    "produtos": "menu",
    "itens": "menu",
}


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def _normalize_key(raw_key: str) -> str:
    clean = _strip_accents(raw_key).lower()
    clean = re.sub(r"[^a-z0-9]+", " ", clean).strip()
    return clean


def resolve_segment_mapping(raw_segment: str | None) -> tuple[str, str | None, str | None]:
    """Mapeia segmento livre para (operation_profile, segment_preset, label_limpo)."""
    cleaned = str(raw_segment or "").strip()
    if not cleaned:
        return "generic", None, None
    normalized = _normalize_key(cleaned)
    for keyword, profile, preset in _PROFILE_KEYWORDS:
        if keyword in normalized:
            return profile, preset, cleaned
    return "generic", "restaurante", cleaned


def parse_order_types_value(value: Any) -> list[str]:
    if isinstance(value, list):
        tokens = [str(item) for item in value]
    else:
        tokens = re.split(r"[,;/|+]+|\be\b", str(value or ""), flags=re.IGNORECASE)

    resolved: list[str] = []
    for token in tokens:
        norm = _normalize_key(token)
        if not norm:
            continue
        candidate: str | None = None
        if any(word in norm for word in ("delivery", "entrega", "tele")):
            candidate = "delivery"
        elif any(word in norm for word in ("retirada", "balcao", "takeaway", "take away", "buscar")):
            candidate = "retirada"
        elif any(word in norm for word in ("salao", "mesa", "consumo", "local", "presencial")):
            candidate = "consumo_local"
        if candidate and candidate not in resolved:
            resolved.append(candidate)
    return resolved


def _format_hhmm(hour: str, minute: str | None) -> str | None:
    h = int(hour)
    m = int(minute or 0)
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return f"{h:02d}:{m:02d}"


def parse_operating_hours_value(value: Any) -> list[dict[str, str]]:
    """Normaliza horários informados em texto ou lista estruturada para [{days, hours}]."""
    if isinstance(value, list):
        rows: list[dict[str, str]] = []
        for entry in value:
            if isinstance(entry, dict):
                days = str(entry.get("days") or entry.get("dias") or "").strip()
                hours = str(entry.get("hours") or entry.get("horas") or entry.get("horario") or "").strip()
                if days and hours:
                    rows.append({"days": days, "hours": hours})
        return rows

    raw_text = str(value or "").strip()
    if not raw_text:
        return []

    chunks = [chunk.strip() for chunk in re.split(r"[;\n]+", raw_text) if chunk.strip()]
    rows: list[dict[str, str]] = []
    for chunk in chunks:
        norm = _normalize_key(chunk)
        days_label = "Todos os dias"
        for pattern, label in _DAY_TOKEN_NORMALIZATION:
            if pattern in norm:
                days_label = label
                break

        time_matches = re.findall(
            r"\b([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\s*h?\b",
            chunk.lower(),
        )
        valid_times = [
            formatted
            for h, m in time_matches
            if (formatted := _format_hhmm(h, m)) is not None
        ]
        if len(valid_times) >= 2:
            rows.append({"days": days_label, "hours": f"{valid_times[0]} - {valid_times[1]}"})
        elif any(word in norm for word in ("24h", "24 horas", "24hrs")):
            rows.append({"days": days_label, "hours": "00:00 - 23:59"})
        else:
            rows.append({"days": days_label, "hours": chunk})
    return rows


def _parse_brl_number(raw: str) -> float | None:
    cleaned = re.sub(r"^r\$\s*", "", raw.strip(), flags=re.IGNORECASE).replace(" ", "")
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    if not re.fullmatch(r"\d+(?:\.\d{1,2})?", cleaned):
        return None
    num = round(float(cleaned), 2)
    if num < 0 or num > 100_000:
        return None
    return num


def _looks_like_category_heading(line: str) -> str | None:
    trimmed = line.strip().lstrip("-•*").strip()
    if not trimmed:
        return None
    if re.search(r"r\$\s*\d|\d+[,.]\d{2}\b", trimmed, flags=re.IGNORECASE):
        return None
    if trimmed.endswith(":"):
        candidate = trimmed[:-1].strip()
        if 2 <= len(candidate) <= 60:
            return candidate
    wrapped = re.fullmatch(r"(?:[*_=-]{1,4}\s*)([^*_=-]{2,48}?)(?:\s*[*_=-]{1,4})", trimmed)
    if wrapped:
        return wrapped.group(1).strip()
    return None


def parse_menu_lines(lines: list[str], default_category: str = "Cardápio") -> tuple[list[dict[str, Any]], list[str]]:
    """Extrai categorias e itens determinísticos a partir de linhas de cardápio."""
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    current_category = default_category

    for raw_line in lines:
        trimmed = raw_line.strip()
        if not trimmed:
            continue

        heading = _looks_like_category_heading(trimmed)
        if heading:
            current_category = heading
            continue

        cleaned = re.sub(r"^[-•*]\s+", "", trimmed).strip()
        # Formato tabular com ';' ou '|' ou '\t'
        for delim in ("\t", ";", "|"):
            if delim in cleaned:
                parts = [part.strip() for part in cleaned.split(delim) if part.strip()]
                if len(parts) >= 2:
                    price = _parse_brl_number(parts[1])
                    if price is not None:
                        items.append(
                            {
                                "name": parts[0],
                                "price": price,
                                "category": current_category,
                                "category_id": slugify_category_id(current_category),
                                "print_destination": infer_category_print_destination(current_category),
                                "description": parts[2] if len(parts) >= 3 else "",
                            }
                        )
                        break
                    if len(parts) >= 3 and (price := _parse_brl_number(parts[2])) is not None:
                        cat_name = parts[0]
                        items.append(
                            {
                                "name": parts[1],
                                "price": price,
                                "category": cat_name,
                                "category_id": slugify_category_id(cat_name),
                                "print_destination": infer_category_print_destination(cat_name),
                                "description": parts[3] if len(parts) >= 4 else "",
                            }
                        )
                        break
        else:
            # Formato livre: "Calabresa - R$ 49,90" ou "Calabresa (mussarela e cebola) - 49.90"
            end_match = re.match(
                r"^(.*?)(?:\s*[-–|:.·]+\s*|\s+)(?:R\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*$",
                cleaned,
                flags=re.IGNORECASE,
            )
            if end_match:
                raw_name = end_match.group(1).strip().rstrip("-–.:·|").strip()
                suffix_slice = cleaned[len(end_match.group(1)) :]
                has_currency_or_decimals = bool(re.search(r"r\$|[.,]\d{2}", suffix_slice, flags=re.IGNORECASE))
                price = _parse_brl_number(end_match.group(2)) if has_currency_or_decimals else None
                if raw_name and price is not None:
                    paren = re.match(r"^(.+?)\s*\(([^()]{3,160})\)$", raw_name)
                    name = paren.group(1).strip() if paren else raw_name
                    description = paren.group(2).strip() if paren else ""
                    items.append(
                        {
                            "name": name,
                            "price": price,
                            "category": current_category,
                            "category_id": slugify_category_id(current_category),
                            "print_destination": infer_category_print_destination(current_category),
                            "description": description,
                        }
                    )
                    continue

            warnings.append(
                f"Linha de cardápio sem preço identificável e ignorada sem invenção: '{cleaned}'."
            )

    return items, warnings


def parse_express_provisioning_input(
    *,
    structured_text: str | None = None,
    raw_json: dict[str, Any] | None = None,
    require_admin_credentials: bool = True,
) -> dict[str, Any]:
    """Interpreta texto estruturado ou JSON sem inventar campos ausentes."""
    warnings: list[str] = []
    fields: dict[str, Any] = {}
    menu_lines: list[str] = []

    if structured_text and structured_text.strip():
        stripped = structured_text.strip()
        if stripped.startswith("{"):
            try:
                decoded = json.loads(stripped)
            except json.JSONDecodeError as exc:
                warnings.append(f"JSON inválido informado no texto estruturado ({exc.msg}).")
            else:
                if isinstance(decoded, dict):
                    raw_json = {**decoded, **(raw_json or {})}
                else:
                    warnings.append("O JSON estruturado precisa ser um objeto na raiz.")
        else:
            in_menu_block = False
            for raw_line in stripped.splitlines():
                line = raw_line.rstrip()
                if not line.strip():
                    continue
                if not in_menu_block:
                    kv_match = re.match(r"^\s*([^:]{2,48}):\s*(.*)$", line)
                    if kv_match:
                        raw_key = kv_match.group(1).strip()
                        raw_val = kv_match.group(2).strip()
                        canonical_key = _KEY_ALIASES.get(_normalize_key(raw_key))
                        if canonical_key == "menu":
                            in_menu_block = True
                            if raw_val:
                                menu_lines.extend(
                                    part.strip() for part in re.split(r"\s*;\s*", raw_val) if part.strip()
                                )
                            continue
                        if canonical_key:
                            fields[canonical_key] = raw_val
                            continue
                    if _looks_like_category_heading(line) or re.search(
                        r"r\$\s*\d|\d+[.,]\d{2}\b", line, flags=re.IGNORECASE
                    ):
                        in_menu_block = True
                        menu_lines.append(line)
                    else:
                        warnings.append(f"Linha não reconhecida e preservada fora dos campos: '{line.strip()}'.")
                else:
                    # Mesmo dentro do bloco Cardápio:, permite chave conhecida após linha em bloco caso não seja item
                    kv_match = re.match(r"^\s*([^:]{2,48}):\s*(.+)$", line)
                    if kv_match:
                        maybe_key = _KEY_ALIASES.get(_normalize_key(kv_match.group(1).strip()))
                        if maybe_key and maybe_key != "menu":
                            in_menu_block = False
                            fields[maybe_key] = kv_match.group(2).strip()
                            continue
                    menu_lines.append(line)

    if raw_json:
        for key, value in raw_json.items():
            if value is None:
                continue
            normalized_key = _normalize_key(str(key))
            mapped = _KEY_ALIASES.get(normalized_key)
            if mapped and value != "":
                fields[mapped] = value
            elif key in {
                "name",
                "slug",
                "subdomain",
                "plan",
                "operation_profile",
                "segment_preset",
                "admin_name",
                "admin_email",
                "phone",
                "address",
                "order_types",
                "operating_hours",
                "menu_text",
                "menu_items",
            }:
                if key == "subdomain":
                    fields["slug"] = value
                else:
                    fields[key] = value

    name = str(fields.get("name") or "").strip()
    slug_raw = str(fields.get("slug") or "").strip().lower()
    slug = slugify_restaurant_name(name) if (not slug_raw and name) else slugify_restaurant_name(slug_raw) if slug_raw else ""

    raw_segment = fields.get("segment")
    inferred_profile, inferred_preset, segment_label = resolve_segment_mapping(
        str(raw_segment) if raw_segment is not None else None
    )
    operation_profile = str(fields.get("operation_profile") or inferred_profile or "generic").strip().lower()
    if operation_profile not in {"generic", "pizzaria", "acai", "churrasco", "marmitaria"}:
        warnings.append(f"Perfil operacional '{operation_profile}' ajustado para 'generic'.")
        operation_profile = "generic"

    segment_preset = fields.get("segment_preset") or inferred_preset

    plan = str(fields.get("plan") or "pro").strip().lower()
    if plan not in _SUPPORTED_PLANS:
        warnings.append(f"Plano '{plan}' desconhecido; mantido 'pro'.")
        plan = "pro"

    admin_name = str(fields.get("admin_name") or "").strip()
    admin_email = str(fields.get("admin_email") or "").strip().lower()
    if admin_email and not _EMAIL_RE.fullmatch(admin_email):
        warnings.append("O e-mail informado não tem formato válido.")

    phone_digits = re.sub(r"\D+", "", str(fields.get("phone") or ""))
    address = str(fields.get("address") or "").strip() or None

    order_types = parse_order_types_value(fields.get("order_types"))
    operating_hours = parse_operating_hours_value(fields.get("operating_hours"))

    extra_menu_text = str(fields.get("menu_text") or "").strip()
    if extra_menu_text:
        menu_lines.extend(line for line in extra_menu_text.splitlines() if line.strip())

    parsed_items, menu_warnings = parse_menu_lines(menu_lines)
    warnings.extend(menu_warnings)

    if isinstance(fields.get("menu_items"), list):
        for raw_item in fields["menu_items"]:
            if not isinstance(raw_item, dict):
                continue
            item_name = str(raw_item.get("name") or raw_item.get("nome") or "").strip()
            raw_price = raw_item.get("price", raw_item.get("preco"))
            if not item_name or raw_price is None:
                continue
            try:
                price_val = round(float(raw_price), 2)
            except (TypeError, ValueError):
                continue
            if price_val < 0:
                continue
            cat_name = str(raw_item.get("category") or raw_item.get("categoria") or "Cardápio").strip() or "Cardápio"
            parsed_items.append(
                {
                    "name": item_name,
                    "price": price_val,
                    "category": cat_name,
                    "category_id": slugify_category_id(cat_name),
                    "print_destination": infer_category_print_destination(cat_name),
                    "description": str(raw_item.get("description") or raw_item.get("descricao") or "").strip(),
                }
            )

    missing_required: list[str] = []
    if len(name) < 2:
        missing_required.append("name")
    if require_admin_credentials:
        if len(admin_name) < 2:
            missing_required.append("admin_name")
        if not admin_email or not _EMAIL_RE.fullmatch(admin_email):
            missing_required.append("admin_email")

    return {
        "fields": {
            "name": name,
            "slug": slug,
            "plan": plan,
            "segment_label": segment_label,
            "operation_profile": operation_profile,
            "segment_preset": segment_preset,
            "admin_name": admin_name,
            "admin_email": admin_email,
            "phone": phone_digits or None,
            "address": address,
            "order_types": order_types,
            "operating_hours": operating_hours,
        },
        "menu_items": parsed_items,
        "missing_required_fields": missing_required,
        "warnings": warnings,
    }
