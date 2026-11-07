from __future__ import annotations

from contextlib import contextmanager, nullcontext
import json
import re
import threading
from typing import Any

from fastapi import HTTPException, status
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import Base, tenant_session_scope

MAX_TENANT_ID = 2_147_483_647
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PROVISIONING_CONCURRENCY_LOCK = threading.RLock()


@contextmanager
def provisioning_concurrency_guard():
    """Serializa a seleção e confirmação de IDs entre requisições simultâneas no processo."""
    with _PROVISIONING_CONCURRENCY_LOCK:
        yield


def _is_safe_identifier(name: str) -> bool:
    return bool(_IDENTIFIER_RE.match(name or ""))


def _quote_ident(name: str) -> str:
    if not _is_safe_identifier(name):
        raise ValueError(f"Identificador SQL inválido: {name!r}")
    return f'"{name}"'


def _list_occupied_restaurants(
    db: Session, *, preserve_transaction: bool = False
) -> dict[int, dict[str, Any]]:
    occupied: dict[int, dict[str, Any]] = {}
    bind = db.get_bind()
    dialect = bind.dialect.name if bind is not None else ""

    if dialect == "postgresql":
        try:
            with db.begin_nested():
                rows = (
                    db.execute(
                        text(
                            "SELECT id, slug, nome "
                            "FROM koma_internal.list_public_restaurants() "
                            "ORDER BY id"
                        )
                    )
                    .mappings()
                    .all()
                )
            for row in rows:
                if row["id"] is not None:
                    rid = int(row["id"])
                    occupied[rid] = {
                        "id": rid,
                        "slug": row.get("slug"),
                        "nome": row.get("nome"),
                    }
            if not preserve_transaction and db.in_transaction():
                db.rollback()
            if occupied:
                return occupied
        except Exception:
            if not preserve_transaction and db.in_transaction():
                db.rollback()

    try:
        ctx = db.begin_nested() if preserve_transaction else nullcontext()
        with ctx:
            rows = (
                db.execute(text("SELECT id, slug, nome FROM restaurantes ORDER BY id"))
                .mappings()
                .all()
            )
        for row in rows:
            if row["id"] is not None:
                rid = int(row["id"])
                occupied[rid] = {
                    "id": rid,
                    "slug": row.get("slug"),
                    "nome": row.get("nome"),
                }
    except Exception:
        if not preserve_transaction and db.in_transaction():
            db.rollback()
    finally:
        if not preserve_transaction and db.in_transaction():
            db.rollback()

    return occupied


def _check_candidate_occupied(
    db: Session,
    candidate_id: int,
    *,
    occupied_map: dict[int, dict[str, Any]] | None = None,
    preserve_transaction: bool = False,
) -> dict[str, Any] | None:
    if occupied_map is not None and candidate_id in occupied_map:
        info = occupied_map[candidate_id]
        return {
            "code": "occupied",
            "source": "public.restaurantes",
            "column": "id",
            "count": 1,
            "detail": (
                f"ID #{candidate_id} está ocupado pelo restaurante "
                f"{info.get('nome') or 'ativo'} ({info.get('slug') or 'sem-slug'})."
            ),
        }

    try:
        scope_ctx = (
            db.begin_nested()
            if preserve_transaction
            else tenant_session_scope(db, candidate_id)
        )
        with scope_ctx:
            row = (
                db.execute(
                    text(
                        "SELECT id, slug, nome FROM restaurantes WHERE id = :id LIMIT 1"
                    ),
                    {"id": candidate_id},
                )
                .mappings()
                .first()
            )
            if row is not None:
                return {
                    "code": "occupied",
                    "source": "public.restaurantes",
                    "column": "id",
                    "count": 1,
                    "detail": (
                        f"ID #{candidate_id} está ocupado pelo restaurante "
                        f"{row.get('nome') or 'ativo'} ({row.get('slug') or 'sem-slug'})."
                    ),
                }
    except Exception:
        if not preserve_transaction and db.in_transaction():
            db.rollback()

    return None


def _discover_tenant_columns(db: Session) -> list[tuple[str, str]]:
    bind = db.get_bind()
    pairs: set[tuple[str, str]] = set()

    for table in Base.metadata.tables.values():
        if table.schema not in (None, "public"):
            continue
        tname = table.name
        if not _is_safe_identifier(tname):
            continue
        for col_name in ("restaurante_id", "destino_restaurante_id"):
            if col_name in table.c and not (tname == "restaurantes" and col_name == "id"):
                pairs.add((tname, col_name))

    try:
        inspector = sa.inspect(bind)
        for tname in inspector.get_table_names():
            if not _is_safe_identifier(tname) or tname in {
                "restaurantes",
                "transaction_reset_backups",
                "storage_objects",
            }:
                continue
            cols = {col["name"] for col in inspector.get_columns(tname)}
            for col_name in ("restaurante_id", "destino_restaurante_id"):
                if col_name in cols:
                    pairs.add((tname, col_name))
    except Exception:
        pass

    return sorted(pairs)


def _inspect_postgres_security_definer(
    db: Session, candidate_id: int, *, preserve_transaction: bool = False
) -> list[dict[str, Any]] | None:
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return None

    try:
        with db.begin_nested():
            rows = (
                db.execute(
                    text(
                        "SELECT blocker_code, source_name, source_column, row_count, detail "
                        "FROM koma_internal.inspect_tenant_id_blockers(:candidate_id)"
                    ),
                    {"candidate_id": candidate_id},
                )
                .mappings()
                .all()
            )
        blockers = [
            {
                "code": str(row["blocker_code"]),
                "source": str(row["source_name"]),
                "column": str(row["source_column"]),
                "count": int(row["row_count"] or 0),
                "detail": str(row["detail"] or ""),
            }
            for row in rows
        ]
        return blockers
    except Exception:
        return None
    finally:
        if not preserve_transaction and db.in_transaction():
            db.rollback()


def _extract_json_restaurante_id(raw_value: Any) -> int | None:
    if raw_value is None:
        return None
    data = raw_value
    if isinstance(raw_value, str):
        try:
            data = json.loads(raw_value)
        except Exception:
            return None
    if isinstance(data, dict) and data.get("restaurante_id") is not None:
        try:
            return int(data["restaurante_id"])
        except (TypeError, ValueError):
            return None
    return None


def _inspect_backup_table_residue(
    db: Session, candidate_id: int, *, preserve_transaction: bool = False
) -> list[dict[str, Any]]:
    blockers: list[dict[str, Any]] = []
    bind = db.get_bind()
    if bind is None:
        return blockers

    candidate_tables: list[tuple[str | None, str, str]] = []
    try:
        inspector = sa.inspect(bind)
        default_tables = set(inspector.get_table_names())
        if "transaction_reset_backups" in default_tables:
            candidate_tables.append(
                (None, "transaction_reset_backups", "koma_internal.transaction_reset_backups")
            )
        if bind.dialect.name == "postgresql":
            try:
                internal_tables = set(inspector.get_table_names(schema="koma_internal"))
                if "transaction_reset_backups" in internal_tables:
                    candidate_tables.append(
                        (
                            "koma_internal",
                            "transaction_reset_backups",
                            "koma_internal.transaction_reset_backups",
                        )
                    )
            except Exception:
                pass
    except Exception:
        pass

    for schema_name, table_name, canonical_source in candidate_tables:
        try:
            inspector = sa.inspect(bind)
            cols = {
                c["name"]
                for c in inspector.get_columns(table_name, schema=schema_name)
            }
            if "restaurante_id" not in cols:
                continue
            qualified = (
                f'{_quote_ident(schema_name)}.{_quote_ident(table_name)}'
                if schema_name
                else _quote_ident(table_name)
            )
            where_clause = "restaurante_id = :id"
            if "detached_from_active_id_at" in cols:
                where_clause += " AND detached_from_active_id_at IS NULL"

            with db.begin_nested():
                count_val = db.execute(
                    text(f"SELECT COUNT(*) FROM {qualified} WHERE {where_clause}"),
                    {"id": candidate_id},
                ).scalar()
                count_int = int(count_val or 0)
                backup_ids: list[str] = []
                if count_int > 0 and "backup_id" in cols:
                    b_rows = db.execute(
                        text(
                            f"SELECT DISTINCT backup_id FROM {qualified} "
                            f"WHERE {where_clause} ORDER BY backup_id"
                        ),
                        {"id": candidate_id},
                    ).fetchall()
                    backup_ids = [str(r[0]) for r in b_rows if r[0]]

            if count_int > 0:
                backup_label = ", ".join(backup_ids) if backup_ids else "sem backup_id"
                blockers.append(
                    {
                        "code": "historical_backup_residue",
                        "source": canonical_source,
                        "column": "restaurante_id",
                        "count": count_int,
                        "backup_ids": backup_ids,
                        "detail": (
                            f"{count_int} registro(s) de backup histórico em "
                            f"{canonical_source} ({backup_label}) vinculados ao ID #{candidate_id}."
                        ),
                    }
                )
        except Exception:
            if not preserve_transaction and db.in_transaction():
                db.rollback()

    return blockers


def _inspect_storage_prefix_residue(
    db: Session, candidate_id: int, *, preserve_transaction: bool = False
) -> list[dict[str, Any]]:
    blockers: list[dict[str, Any]] = []
    bind = db.get_bind()
    if bind is None:
        return blockers

    candidate_tables: list[tuple[str | None, str]] = []
    try:
        inspector = sa.inspect(bind)
        default_tables = set(inspector.get_table_names())
        if "storage_objects" in default_tables:
            candidate_tables.append((None, "storage_objects"))
        if bind.dialect.name == "postgresql":
            try:
                storage_tables = set(inspector.get_table_names(schema="storage"))
                if "objects" in storage_tables:
                    candidate_tables.append(("storage", "objects"))
            except Exception:
                pass
    except Exception:
        pass

    prefix = f"{candidate_id}/%"
    for schema_name, table_name in candidate_tables:
        try:
            qualified = (
                f'{_quote_ident(schema_name)}.{_quote_ident(table_name)}'
                if schema_name
                else _quote_ident(table_name)
            )
            with db.begin_nested():
                count_val = db.execute(
                    text(
                        f"SELECT COUNT(*) FROM {qualified} "
                        "WHERE bucket_id = 'cardapio-assets' AND name LIKE :prefix"
                    ),
                    {"prefix": prefix},
                ).scalar()
                count_int = int(count_val or 0)
            if count_int > 0:
                blockers.append(
                    {
                        "code": "storage_prefix_residue",
                        "source": "storage.objects",
                        "column": "name",
                        "count": count_int,
                        "detail": (
                            f"{count_int} objeto(s) órfão(s) em storage.objects "
                            f"(bucket cardapio-assets) sob o prefixo {candidate_id}/."
                        ),
                    }
                )
        except Exception:
            if not preserve_transaction and db.in_transaction():
                db.rollback()

    return blockers


def inspect_tenant_id_eligibility(
    db: Session,
    candidate_id: int,
    *,
    occupied_map: dict[int, dict[str, Any]] | None = None,
    preserve_transaction: bool = False,
) -> dict[str, Any]:
    """
    Executa a verificação completa de elegibilidade para reutilização segura de um ID de tenant.

    Um ID só é elegível quando:
    1. É um inteiro positivo válido (1 <= id <= 2147483647);
    2. Não está ocupado em `public.restaurantes`;
    3. Não possui registros residuais em nenhuma tabela `public.*` com `restaurante_id`
       ou `destino_restaurante_id` (incluindo `super_admin_audit_logs` e `product_image_retirements`);
    4. Não possui registros de backup ativos/não desacoplados em `koma_internal.transaction_reset_backups`;
    5. Não possui objetos órfãos sob o prefixo `<id>/` em `storage.objects` (`cardapio-assets`).
    """
    try:
        normalized_id = int(candidate_id)
    except (TypeError, ValueError):
        normalized_id = 0

    if normalized_id < 1 or normalized_id > MAX_TENANT_ID:
        return {
            "id": normalized_id,
            "eligible": False,
            "status": "invalid_id",
            "blockers": [
                {
                    "code": "invalid_id",
                    "source": "input",
                    "column": "id",
                    "count": 1,
                    "detail": "O ID do restaurante deve ser um inteiro positivo válido (>= 1).",
                }
            ],
        }

    occupied_blocker = _check_candidate_occupied(
        db,
        normalized_id,
        occupied_map=occupied_map,
        preserve_transaction=preserve_transaction,
    )
    if occupied_blocker is not None:
        return {
            "id": normalized_id,
            "eligible": False,
            "status": "occupied",
            "blockers": [occupied_blocker],
        }

    blockers_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}

    pg_blockers = _inspect_postgres_security_definer(
        db, normalized_id, preserve_transaction=preserve_transaction
    )
    if pg_blockers is not None:
        for item in pg_blockers:
            key = (item["code"], item["source"], item["column"])
            blockers_by_key[key] = item
        if any(item["code"] == "occupied" for item in pg_blockers):
            return {
                "id": normalized_id,
                "eligible": False,
                "status": "occupied",
                "blockers": list(blockers_by_key.values()),
            }

    # Inspeção portátil para SQLite e fallback/complemento em PostgreSQL
    if pg_blockers is None:
        tenant_columns = _discover_tenant_columns(db)
        scope_ctx = (
            db.begin_nested()
            if preserve_transaction
            else tenant_session_scope(db, normalized_id)
        )
        try:
            with scope_ctx:
                for table_name, col_name in tenant_columns:
                    q_table = _quote_ident(table_name)
                    q_col = _quote_ident(col_name)
                    try:
                        with db.begin_nested():
                            cnt = db.execute(
                                text(
                                    f"SELECT COUNT(*) FROM {q_table} WHERE {q_col} = :id"
                                ),
                                {"id": normalized_id},
                            ).scalar()
                            cnt_int = int(cnt or 0)
                    except Exception:
                        continue
                    if cnt_int > 0:
                        code = (
                            "audit_log_residue"
                            if table_name == "super_admin_audit_logs"
                            else "public_table_residue"
                        )
                        source = f"public.{table_name}"
                        key = (code, source, col_name)
                        blockers_by_key[key] = {
                            "code": code,
                            "source": source,
                            "column": col_name,
                            "count": cnt_int,
                            "detail": (
                                f"{cnt_int} registro(s) residual(is) em "
                                f"public.{table_name}.{col_name} para o ID #{normalized_id}."
                            ),
                        }

                # Inspeciona também referências em JSON de super_admin_audit_logs
                try:
                    with db.begin_nested():
                        audit_rows = db.execute(
                            text(
                                "SELECT before_data, after_data "
                                "FROM super_admin_audit_logs "
                                "WHERE restaurante_id IS NULL OR restaurante_id != :id"
                            ),
                            {"id": normalized_id},
                        ).fetchall()
                    json_matches = 0
                    for before_raw, after_raw in audit_rows:
                        if (
                            _extract_json_restaurante_id(before_raw) == normalized_id
                            or _extract_json_restaurante_id(after_raw) == normalized_id
                        ):
                            json_matches += 1
                    if json_matches > 0:
                        key = (
                            "audit_log_residue",
                            "public.super_admin_audit_logs",
                            "json_payload",
                        )
                        blockers_by_key[key] = {
                            "code": "audit_log_residue",
                            "source": "public.super_admin_audit_logs",
                            "column": "json_payload",
                            "count": json_matches,
                            "detail": (
                                f"{json_matches} registro(s) de auditoria referenciam o "
                                f"ID #{normalized_id} em before_data/after_data."
                            ),
                        }
                except Exception:
                    pass
        except Exception:
            if not preserve_transaction and db.in_transaction():
                db.rollback()

    for b_item in _inspect_backup_table_residue(
        db, normalized_id, preserve_transaction=preserve_transaction
    ):
        key = (b_item["code"], b_item["source"], b_item["column"])
        blockers_by_key.setdefault(key, b_item)

    for s_item in _inspect_storage_prefix_residue(
        db, normalized_id, preserve_transaction=preserve_transaction
    ):
        key = (s_item["code"], s_item["source"], s_item["column"])
        blockers_by_key.setdefault(key, s_item)

    if not preserve_transaction and db.in_transaction():
        db.rollback()

    blockers = list(blockers_by_key.values())
    if not blockers:
        status_value = "eligible"
    elif any(b["code"] == "occupied" for b in blockers):
        status_value = "occupied"
    else:
        status_value = "ineligible_history"

    return {
        "id": normalized_id,
        "eligible": len(blockers) == 0,
        "status": status_value,
        "blockers": blockers,
    }


def format_ineligible_id_detail(report: dict[str, Any]) -> str:
    candidate_id = report.get("id")
    status_value = report.get("status")
    blockers = report.get("blockers") or []

    if status_value == "invalid_id":
        return "O ID do restaurante informado é inválido. Informe um inteiro positivo (>= 1)."
    if status_value == "occupied":
        first_detail = blockers[0].get("detail") if blockers else ""
        return (
            first_detail
            or f"O ID #{candidate_id} já está ocupado por um restaurante ativo e não pode ser reutilizado."
        )

    reasons = [
        str(b.get("detail") or f"{b.get('source')}.{b.get('column')} ({b.get('count')})")
        for b in blockers
    ]
    joined = " ".join(reasons)
    return (
        f"O ID #{candidate_id} possui registros históricos ou resíduos associados e "
        f"não pode ser reutilizado com segurança: {joined}"
    )


def suggest_reusable_tenant_ids(
    db: Session,
    *,
    limit: int = 10,
    preferred_id: int = 1,
    candidate_id: int | None = None,
    excluded_ids: set[int] | None = None,
) -> dict[str, Any]:
    """
    Calcula o menor ID desocupado (>= 1) que passa na verificação completa de elegibilidade,
    priorizando o ID 1 quando elegível, e lista outros IDs elegíveis para escolha manual.
    """
    safe_limit = max(1, min(int(limit or 10), 25))
    excluded = set(excluded_ids or set())
    occupied_map = _list_occupied_restaurants(db, preserve_transaction=False)
    max_occupied = max(occupied_map.keys(), default=0)
    upper_scan = max(max_occupied + safe_limit + 5, safe_limit + 10)

    eligible_ids: list[int] = []
    candidates: list[dict[str, Any]] = []
    reports_by_id: dict[int, dict[str, Any]] = {}

    current_id = 1
    while current_id <= upper_scan and len(eligible_ids) < safe_limit:
        if current_id in excluded:
            current_id += 1
            continue
        report = inspect_tenant_id_eligibility(
            db,
            current_id,
            occupied_map=occupied_map,
            preserve_transaction=False,
        )
        reports_by_id[current_id] = report
        if current_id <= max(max_occupied + 2, 10) or report["eligible"]:
            candidates.append(report)
        if report["eligible"]:
            eligible_ids.append(current_id)
        current_id += 1

    # Garante que se o ID prioritário (1) for elegível, ele seja sempre o primeiro sugerido.
    priority_report = reports_by_id.get(preferred_id) or inspect_tenant_id_eligibility(
        db,
        preferred_id,
        occupied_map=occupied_map,
        preserve_transaction=False,
    )

    if (
        priority_report["eligible"]
        and preferred_id not in excluded
        and (not eligible_ids or eligible_ids[0] != preferred_id)
    ):
        eligible_ids = [
            preferred_id,
            *[eid for eid in eligible_ids if eid != preferred_id],
        ][:safe_limit]

    suggested_id = eligible_ids[0] if eligible_ids else None

    candidate_report = None
    if candidate_id is not None:
        candidate_report = reports_by_id.get(int(candidate_id)) or inspect_tenant_id_eligibility(
            db,
            int(candidate_id),
            occupied_map=occupied_map,
            preserve_transaction=False,
        )

    return {
        "suggested_id": suggested_id,
        "eligible_ids": eligible_ids,
        "priority_id": preferred_id,
        "priority_report": priority_report,
        "candidate_report": candidate_report,
        "candidates": candidates,
    }


def reserve_superadmin_tenant_id(
    db: Session,
    *,
    requested_id: int | None = None,
    excluded_ids: set[int] | None = None,
) -> tuple[int, str]:
    """
    Seleciona ou valida um ID para provisionamento autorizado pelo Super Admin.
    Retorna `(tenant_id, selection_mode)` onde `selection_mode` é `'manual'`
    ou `'auto_lowest_eligible'`. Nunca altera a sequência PostgreSQL (`setval`).
    """
    excluded = set(excluded_ids or set())
    occupied_map = _list_occupied_restaurants(db, preserve_transaction=False)

    if requested_id is not None:
        target_id = int(requested_id)
        if target_id in excluded:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"O ID #{target_id} acabou de ser alocado por outro provisionamento "
                    "simultâneo e não está mais disponível."
                ),
            )
        report = inspect_tenant_id_eligibility(
            db,
            target_id,
            occupied_map=occupied_map,
            preserve_transaction=False,
        )
        if not report["eligible"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=format_ineligible_id_detail(report),
            )
        return target_id, "manual"

    suggestion = suggest_reusable_tenant_ids(
        db,
        limit=5,
        preferred_id=1,
        excluded_ids=excluded,
    )
    suggested_id = suggestion.get("suggested_id")
    if suggested_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não foi possível encontrar um ID elegível livre para o novo restaurante.",
        )
    return int(suggested_id), "auto_lowest_eligible"


def assert_tenant_id_eligible_in_locked_tx(
    db: Session,
    tenant_id: int,
    *,
    requested_id: int | None = None,
) -> None:
    """
    Revalida a elegibilidade do ID dentro da transação já protegida por lock
    (`pg_advisory_xact_lock`), sem desfazer a transação ativa.
    """
    report = inspect_tenant_id_eligibility(
        db,
        int(tenant_id),
        preserve_transaction=True,
    )
    if not report["eligible"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=format_ineligible_id_detail(report),
        )


def reserve_sequential_tenant_id(
    db: Session,
    *,
    excluded_ids: set[int] | None = None,
) -> int:
    """
    Reserva sequencialmente um ID para fluxos automáticos públicos (checkout self-service),
    sem permitir escolha manual de IDs nem reutilizar IDs históricos baixos e sem chamar `setval`.
    """
    excluded = set(excluded_ids or set())
    occupied_map = _list_occupied_restaurants(db, preserve_transaction=False)
    bind = db.get_bind()

    if bind is not None and bind.dialect.name == "postgresql":
        try:
            for _ in range(100):
                next_id = db.execute(
                    text("SELECT nextval(pg_get_serial_sequence('public.restaurantes', 'id'))")
                ).scalar_one()
                db.rollback()
                candidate = int(next_id)
                if candidate in excluded:
                    continue
                report = inspect_tenant_id_eligibility(
                    db,
                    candidate,
                    occupied_map=occupied_map,
                    preserve_transaction=False,
                )
                if report["eligible"]:
                    return candidate
        except Exception:
            if db.in_transaction():
                db.rollback()

    candidate = max(occupied_map.keys(), default=0) + 1
    while True:
        if candidate not in excluded:
            report = inspect_tenant_id_eligibility(
                db,
                candidate,
                occupied_map=occupied_map,
                preserve_transaction=False,
            )
            if report["eligible"]:
                return candidate
        candidate += 1
