"""Reconcilia um catálogo de Marmitaria de forma aditiva e tenant-scoped.

Uso seguro:
  python -m tools.reconcile_marmitaria_catalog --tenant-id 1 --spec-base64 <BASE64>
  python -m tools.reconcile_marmitaria_catalog --tenant-id 1 --spec-base64 <BASE64> --apply --reason "..."

Sem --apply, toda alteração é revertida ao final. O spec deve incluir guards em
"expected" para impedir que o comando seja aplicado ao restaurante errado.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import unicodedata
import uuid
from decimal import Decimal
from typing import Any

from app.catalog_addons import normalize_catalog_name
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Categoria,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
)
from app.restaurant_profile_models import RestauranteOperationProfile


class ReconcileError(RuntimeError):
    pass


def _money(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized or uuid.uuid4().hex[:8]


def _load_spec(encoded: str) -> dict[str, Any]:
    try:
        raw = base64.b64decode(encoded.encode("ascii"), validate=True).decode("utf-8")
        payload = json.loads(raw)
    except Exception as exc:
        raise ReconcileError("Spec inválido: informe JSON UTF-8 em base64.") from exc
    if not isinstance(payload, dict):
        raise ReconcileError("Spec inválido: a raiz precisa ser um objeto JSON.")
    return payload


def _one_by_name(items: list[Any], name: str, label: str) -> Any | None:
    expected = normalize_catalog_name(name)
    matches = [item for item in items if normalize_catalog_name(str(item.nome)) == expected]
    if len(matches) > 1:
        raise ReconcileError(f"Há mais de um {label} chamado {name!r}; reconciliação abortada.")
    return matches[0] if matches else None


def _category(db, tenant_id: int, name: str, destination: str, changes: dict[str, list[str]]) -> Categoria:
    categories = db.query(Categoria).filter(Categoria.restaurante_id == tenant_id).all()
    category = _one_by_name(categories, name, "categoria")
    if category is not None:
        return category

    base_id = f"cat-{_slug(name)}"
    category_id = base_id
    if db.query(Categoria).filter(Categoria.restaurante_id == tenant_id, Categoria.id == category_id).first():
        category_id = f"{base_id}-{uuid.uuid4().hex[:8]}"
    category = Categoria(
        id=category_id,
        restaurante_id=tenant_id,
        nome=name,
        destino_impressao=destination,
    )
    db.add(category)
    db.flush()
    changes["categories_created"].append(name)
    return category


def _guard_target(db, tenant_id: int, spec: dict[str, Any]) -> None:
    expected = spec.get("expected")
    if not isinstance(expected, dict):
        raise ReconcileError("Spec precisa conter expected com os guards do restaurante.")

    restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).with_for_update().one_or_none()
    if restaurant is None:
        raise ReconcileError(f"Restaurante {tenant_id} não encontrado.")

    profile = (
        db.query(RestauranteOperationProfile)
        .filter(RestauranteOperationProfile.restaurante_id == tenant_id)
        .one_or_none()
    )
    if profile is None or profile.profile_key != "marmitaria":
        raise ReconcileError("O tenant informado não está no perfil Marmitaria.")

    product_id = str(expected.get("product_id") or "").strip()
    product_name = str(expected.get("product_name") or "").strip()
    if not product_id or not product_name:
        raise ReconcileError("expected.product_id e expected.product_name são obrigatórios.")

    product = (
        db.query(Produto)
        .filter(Produto.restaurante_id == tenant_id, Produto.id == product_id)
        .one_or_none()
    )
    if product is None:
        raise ReconcileError(f"Produto sentinela {product_id!r} não encontrado.")
    if normalize_catalog_name(product.nome) != normalize_catalog_name(product_name):
        raise ReconcileError(
            f"Produto sentinela divergente: esperado {product_name!r}, encontrado {product.nome!r}."
        )

    if expected.get("product_price") is not None and _money(product.preco) != _money(expected["product_price"]):
        raise ReconcileError(
            f"Preço do produto sentinela divergente: esperado {expected['product_price']}, encontrado {product.preco}."
        )

    groups = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == tenant_id).all()
    for group_name in expected.get("groups") or []:
        if _one_by_name(groups, str(group_name), "grupo") is None:
            raise ReconcileError(f"Grupo sentinela {group_name!r} não encontrado.")


def _reconcile_groups(db, tenant_id: int, spec: dict[str, Any], changes: dict[str, list[str]]) -> dict[str, GrupoModificador]:
    all_groups = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == tenant_id).all()
    resolved: dict[str, GrupoModificador] = {}
    groups_spec = spec.get("groups") or {}
    if not isinstance(groups_spec, dict):
        raise ReconcileError("groups precisa ser um objeto nome -> lista de opções.")

    for group_name, desired_options in groups_spec.items():
        group = _one_by_name(all_groups, str(group_name), "grupo")
        if group is None:
            raise ReconcileError(
                f"Grupo {group_name!r} não existe. Crie o grupo pela interface antes de reconciliar as opções."
            )
        resolved[normalize_catalog_name(str(group_name))] = group
        options = (
            db.query(OpcaoModificador)
            .filter(
                OpcaoModificador.restaurante_id == tenant_id,
                OpcaoModificador.grupo_id == group.id,
            )
            .all()
        )
        seen = {}
        for option in options:
            key = normalize_catalog_name(option.nome)
            if key in seen:
                raise ReconcileError(
                    f"O grupo {group.nome!r} já possui opções duplicadas normalizadas como {option.nome!r}; resolva antes de aplicar."
                )
            seen[key] = option

        if not isinstance(desired_options, list):
            raise ReconcileError(f"As opções de {group_name!r} precisam ser uma lista.")
        for option_name in desired_options:
            option_name = str(option_name).strip()
            if not option_name:
                continue
            key = normalize_catalog_name(option_name)
            if key in seen:
                continue
            option = OpcaoModificador(
                id=f"opmod-{uuid.uuid4().hex[:8]}",
                restaurante_id=tenant_id,
                grupo_id=group.id,
                nome=option_name,
                preco_adicional=0,
                ativo=True,
            )
            db.add(option)
            seen[key] = option
            changes["options_created"].append(f"{group.nome}: {option_name}")
    db.flush()
    return resolved


def _product_by_name(db, tenant_id: int, name: str) -> Produto | None:
    products = db.query(Produto).filter(Produto.restaurante_id == tenant_id).all()
    return _one_by_name(products, name, "produto")


def _reconcile_products(db, tenant_id: int, spec: dict[str, Any], changes: dict[str, list[str]]) -> None:
    products_spec = spec.get("products") or []
    if not isinstance(products_spec, list):
        raise ReconcileError("products precisa ser uma lista.")

    for item in products_spec:
        if not isinstance(item, dict):
            raise ReconcileError("Cada produto do spec precisa ser um objeto.")
        name = str(item.get("name") or "").strip()
        category_name = str(item.get("category") or "").strip()
        if not name or not category_name:
            raise ReconcileError("Produto sem name/category no spec.")
        destination = str(item.get("category_destination") or "COZINHA").upper()
        if destination not in {"COZINHA", "BAR", "NENHUM"}:
            raise ReconcileError(f"Destino inválido para {category_name!r}.")
        category = _category(db, tenant_id, category_name, destination, changes)

        aliases = [name, *[str(value) for value in item.get("aliases") or []]]
        matches: list[Produto] = []
        all_products = db.query(Produto).filter(Produto.restaurante_id == tenant_id).all()
        normalized_aliases = {normalize_catalog_name(value) for value in aliases}
        for product in all_products:
            if normalize_catalog_name(product.nome) in normalized_aliases:
                matches.append(product)
        unique_matches = {product.id: product for product in matches}
        if len(unique_matches) > 1:
            raise ReconcileError(f"Mais de um produto corresponde a {name!r}; reconciliação abortada.")

        product = next(iter(unique_matches.values()), None)
        created = product is None
        if product is None:
            product = Produto(
                id=f"catalog-prod-{uuid.uuid4().hex[:10]}",
                restaurante_id=tenant_id,
                nome=name,
                categoria_id=category.id,
                preco=_money(item.get("price", 0)),
                descricao=str(item.get("description") or ""),
                imagem="",
                imagens_galeria=[],
                ativo=bool(item.get("active", True)),
            )
            db.add(product)
            changes["products_created"].append(name)
        else:
            before = (product.nome, _money(product.preco), product.categoria_id, product.descricao, bool(product.ativo))
            product.nome = name
            product.preco = _money(item.get("price", product.preco))
            product.categoria_id = category.id
            if "description" in item:
                product.descricao = str(item.get("description") or "")
            if "active" in item:
                product.ativo = bool(item["active"])
            after = (product.nome, _money(product.preco), product.categoria_id, product.descricao, bool(product.ativo))
            if before != after:
                changes["products_updated"].append(name)
        if created:
            db.flush()


def _resolve_size_product(db, tenant_id: int, size: str, name: str, shared_category: Categoria) -> tuple[Produto, bool]:
    key = size.lower()
    product = (
        db.query(Produto)
        .filter(Produto.restaurante_id == tenant_id, Produto.marmitaria_tamanho == key)
        .one_or_none()
    )
    if product is not None:
        return product, False

    by_name = _product_by_name(db, tenant_id, name)
    if by_name is not None:
        if by_name.marmitaria_tamanho not in (None, key):
            raise ReconcileError(f"Produto {name!r} já representa outro tamanho de marmita.")
        by_name.marmitaria_tamanho = key
        by_name.categoria_id = shared_category.id
        return by_name, False

    product = Produto(
        id=f"marmita-prod-{uuid.uuid4().hex}",
        restaurante_id=tenant_id,
        categoria_id=shared_category.id,
        nome=name,
        preco=0,
        ativo=False,
        marmitaria_tamanho=key,
    )
    db.add(product)
    db.flush()
    return product, True


def _reconcile_sizes(
    db,
    tenant_id: int,
    spec: dict[str, Any],
    groups: dict[str, GrupoModificador],
    changes: dict[str, list[str]],
) -> None:
    sizes_spec = spec.get("sizes") or {}
    if not isinstance(sizes_spec, dict):
        raise ReconcileError("sizes precisa ser um objeto.")

    existing_sizes = (
        db.query(Produto)
        .filter(Produto.restaurante_id == tenant_id, Produto.marmitaria_tamanho.isnot(None))
        .all()
    )
    shared_category = None
    if existing_sizes:
        shared_category = (
            db.query(Categoria)
            .filter(
                Categoria.restaurante_id == tenant_id,
                Categoria.id == existing_sizes[0].categoria_id,
            )
            .one()
        )
    if shared_category is None:
        shared_category = _category(db, tenant_id, "Quentinhas", "COZINHA", changes)
    shared_category.marmitaria_tamanho = True

    for raw_size, item in sizes_spec.items():
        size = str(raw_size).upper()
        if size not in {"P", "M", "G"}:
            raise ReconcileError(f"Tamanho inválido no spec: {raw_size!r}.")
        if not isinstance(item, dict):
            raise ReconcileError(f"Configuração do tamanho {size} precisa ser um objeto.")
        name = str(item.get("name") or f"Quentinha {size}").strip()
        product, created = _resolve_size_product(db, tenant_id, size, name, shared_category)
        product.nome = name
        product.preco = _money(item.get("price", product.preco or 0))
        product.ativo = bool(item.get("active", True))
        product.categoria_id = shared_category.id
        product.marmitaria_tamanho = size.lower()

        rules = item.get("rules") or {}
        if product.ativo and not rules:
            raise ReconcileError(f"Tamanho {size} ativo sem composição.")
        if not isinstance(rules, dict):
            raise ReconcileError(f"rules de {size} precisa ser um objeto.")

        db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == tenant_id,
            ProdutoGrupoModificador.produto_id == product.id,
        ).delete(synchronize_session=False)

        for group_name, rule in rules.items():
            group = groups.get(normalize_catalog_name(str(group_name)))
            if group is None:
                raise ReconcileError(f"Grupo {group_name!r} usado em {size} não foi resolvido.")
            if not isinstance(rule, dict):
                raise ReconcileError(f"Regra {group_name!r} de {size} precisa ser um objeto.")
            minimum = int(rule.get("min"))
            maximum = int(rule.get("max"))
            if minimum < 0 or maximum < 1 or minimum > maximum:
                raise ReconcileError(f"Limites inválidos em {size}/{group_name}.")
            mode = str(rule.get("mode") or "tipos")
            if mode not in {"tipos", "porcoes"}:
                raise ReconcileError(f"Modo inválido em {size}/{group_name}.")
            db.add(
                ProdutoGrupoModificador(
                    restaurante_id=tenant_id,
                    produto_id=product.id,
                    grupo_id=group.id,
                    min_selecoes=minimum,
                    max_selecoes=maximum,
                    modo_selecao=mode,
                )
            )
        changes["sizes_created" if created else "sizes_updated"].append(size)
    db.flush()


def reconcile(*, tenant_id: int, spec: dict[str, Any], apply: bool, reason: str) -> dict[str, Any]:
    changes: dict[str, list[str]] = {
        "categories_created": [],
        "options_created": [],
        "products_created": [],
        "products_updated": [],
        "sizes_created": [],
        "sizes_updated": [],
    }

    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        _guard_target(db, tenant_id, spec)
        groups = _reconcile_groups(db, tenant_id, spec, changes)
        _reconcile_products(db, tenant_id, spec, changes)
        _reconcile_sizes(db, tenant_id, spec, groups, changes)

        result = {
            "tenant_id": tenant_id,
            "mode": "apply" if apply else "dry-run",
            "changes": changes,
        }
        if apply:
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor="catalog-reconcile-tool",
                    action="CATALOG_RECONCILE",
                    reason=reason,
                    before_data={"expected": spec.get("expected")},
                    after_data=changes,
                )
            )
            db.commit()
        else:
            db.rollback()
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        current_restaurante_id.reset(token)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcilia catálogo de Marmitaria sem substituir o catálogo inteiro.")
    parser.add_argument("--tenant-id", type=int, required=True)
    parser.add_argument("--spec-base64", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--reason", default="Reconciliação manual de catálogo solicitada pelo responsável do restaurante.")
    args = parser.parse_args()

    if args.tenant_id <= 0:
        raise ReconcileError("tenant-id deve ser positivo.")
    spec = _load_spec(args.spec_base64)
    result = reconcile(
        tenant_id=args.tenant_id,
        spec=spec,
        apply=args.apply,
        reason=args.reason,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
