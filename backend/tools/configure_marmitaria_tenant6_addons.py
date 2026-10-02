"""Configuração operacional segura dos adicionais pagos e guarnições da Quentinha G (tenant 6).

Uso:
  python -m tools.configure_marmitaria_tenant6_addons --tenant-id 6
  python -m tools.configure_marmitaria_tenant6_addons --tenant-id 6 --apply \
    --reason "Go-live: adicionais pagos e guarnições livres"

Sem --apply, toda alteração é revertida ao final.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

try:
    import dotenv

    dotenv.load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    dotenv.load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass

if os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").startswith("sb_publishable_"):
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""

from app.catalog_addons import normalize_catalog_name
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
)
from app.restaurant_profile_models import RestauranteOperationProfile


class MarmitariaTenant6ConfigError(RuntimeError):
    pass


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _group_by_name(groups: list[GrupoModificador], name: str) -> GrupoModificador | None:
    target = normalize_catalog_name(name)
    matches = [group for group in groups if normalize_catalog_name(group.nome) == target]
    if len(matches) > 1:
        raise MarmitariaTenant6ConfigError(
            f"Há mais de um grupo equivalente a {name!r}; resolva a duplicidade antes de continuar."
        )
    return matches[0] if matches else None


def _options_by_name(options: list[OpcaoModificador], *, group_name: str) -> dict[str, OpcaoModificador]:
    result: dict[str, OpcaoModificador] = {}
    for option in options:
        key = normalize_catalog_name(option.nome)
        if key in result:
            raise MarmitariaTenant6ConfigError(
                f"Há opções duplicadas por nome no grupo {group_name!r}: {option.nome!r}."
            )
        result[key] = option
    return result


def _paid_price_for_protein(name: str) -> Decimal:
    normalized = normalize_catalog_name(name)
    return Decimal("2.00") if "ovo" in normalized else Decimal("5.00")


def configure_tenant6_addons(*, tenant_id: int, apply: bool, reason: str) -> dict[str, Any]:
    if tenant_id != 6:
        raise MarmitariaTenant6ConfigError(
            f"Este script é estritamente restrito ao restaurante id=6 (recebido: {tenant_id})."
        )

    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        restaurant = (
            db.query(Restaurante)
            .filter(Restaurante.id == tenant_id)
            .with_for_update()
            .one_or_none()
        )
        if restaurant is None:
            raise MarmitariaTenant6ConfigError("Restaurante 6 não encontrado.")
        if restaurant.nome != "Quentinha Caseira":
            raise MarmitariaTenant6ConfigError(
                f"Nome inesperado para o restaurante 6: {restaurant.nome!r}."
            )

        profile = (
            db.query(RestauranteOperationProfile)
            .filter(RestauranteOperationProfile.restaurante_id == tenant_id)
            .one_or_none()
        )
        if profile is None or profile.profile_key != "marmitaria":
            raise MarmitariaTenant6ConfigError(
                "Restaurante 6 não possui perfil operacional 'marmitaria'."
            )

        other_groups_before = db.query(GrupoModificador).filter(
            GrupoModificador.restaurante_id != tenant_id
        ).count()
        other_options_before = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id != tenant_id
        ).count()
        other_links_before = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id != tenant_id
        ).count()
        tenant_options_before = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == tenant_id
        ).count()

        groups = db.query(GrupoModificador).filter(
            GrupoModificador.restaurante_id == tenant_id
        ).all()
        proteinas = _group_by_name(groups, "Proteínas")
        guarnicoes = _group_by_name(groups, "Guarnições")
        if proteinas is None or guarnicoes is None:
            raise MarmitariaTenant6ConfigError(
                "Grupos Proteínas e Guarnições precisam existir antes desta configuração."
            )

        products_g = db.query(Produto).filter(
            Produto.restaurante_id == tenant_id,
            Produto.marmitaria_tamanho == "g",
        ).all()
        if len(products_g) != 1:
            raise MarmitariaTenant6ConfigError(
                f"Esperava exatamente uma Quentinha G; encontrados {len(products_g)} registros."
            )
        quentinha_g = products_g[0]

        changes: list[str] = []
        created: list[str] = []
        reused: list[str] = []

        paid_group = _group_by_name(groups, "Adicionais pagos")
        if paid_group is None:
            paid_group = GrupoModificador(
                id=f"grp-paid-t6-{uuid.uuid4().hex[:12]}",
                restaurante_id=tenant_id,
                nome="Adicionais pagos",
                min_selecoes=0,
                max_selecoes=20,
                tipo="opcional",
            )
            db.add(paid_group)
            db.flush()
            created.append(f"Grupo: {paid_group.nome} (id={paid_group.id})")
        else:
            reused.append(f"Grupo: {paid_group.nome} (id={paid_group.id})")

        desired_group_fields = {
            "nome": "Adicionais pagos",
            "min_selecoes": 0,
            "max_selecoes": 20,
            "tipo": "opcional",
        }
        for field, expected in desired_group_fields.items():
            current = getattr(paid_group, field)
            if current != expected:
                changes.append(f"Grupo Adicionais pagos: {field} {current!r} -> {expected!r}")
                setattr(paid_group, field, expected)

        protein_options = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == tenant_id,
            OpcaoModificador.grupo_id == proteinas.id,
        ).all()
        if not protein_options:
            raise MarmitariaTenant6ConfigError("O grupo Proteínas não possui opções cadastradas.")
        source_by_name = _options_by_name(protein_options, group_name=proteinas.nome)

        paid_options = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == tenant_id,
            OpcaoModificador.grupo_id == paid_group.id,
        ).all()
        paid_by_name = _options_by_name(paid_options, group_name=paid_group.nome)

        for normalized, source in source_by_name.items():
            expected_price = _paid_price_for_protein(source.nome)
            paid = paid_by_name.get(normalized)
            if paid is None:
                paid = OpcaoModificador(
                    id=f"opmod-paid-t6-{uuid.uuid4().hex[:12]}",
                    restaurante_id=tenant_id,
                    grupo_id=paid_group.id,
                    nome=source.nome,
                    preco_adicional=expected_price,
                    ativo=bool(source.ativo),
                )
                db.add(paid)
                created.append(
                    f"Adicional: {source.nome} (+R$ {expected_price:.2f}, ativo={bool(source.ativo)})"
                )
                continue

            reused.append(f"Adicional: {paid.nome} (id={paid.id})")
            if paid.nome != source.nome:
                changes.append(f"Adicional: nome {paid.nome!r} -> {source.nome!r}")
                paid.nome = source.nome
            if _money(paid.preco_adicional) != expected_price:
                changes.append(
                    f"Adicional {source.nome}: R$ {_money(paid.preco_adicional):.2f} -> R$ {expected_price:.2f}"
                )
                paid.preco_adicional = expected_price
            if bool(paid.ativo) != bool(source.ativo):
                changes.append(
                    f"Adicional {source.nome}: ativo {bool(paid.ativo)} -> {bool(source.ativo)}"
                )
                paid.ativo = bool(source.ativo)

        for normalized, paid in paid_by_name.items():
            if normalized not in source_by_name and paid.ativo:
                changes.append(f"Adicional órfão pausado: {paid.nome}")
                paid.ativo = False

        links = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == tenant_id,
            ProdutoGrupoModificador.produto_id == quentinha_g.id,
        ).all()

        def ensure_rule(
            group: GrupoModificador,
            *,
            minimo: int,
            maximo: int,
            modo: str,
        ) -> ProdutoGrupoModificador:
            matches = [link for link in links if link.grupo_id == group.id]
            if len(matches) > 1:
                raise MarmitariaTenant6ConfigError(
                    f"Há vínculos duplicados do grupo {group.nome!r} na Quentinha G."
                )
            if matches:
                link = matches[0]
                reused.append(f"Regra Quentinha G: {group.nome} (link={link.id})")
            else:
                link = ProdutoGrupoModificador(
                    restaurante_id=tenant_id,
                    produto_id=quentinha_g.id,
                    grupo_id=group.id,
                    min_selecoes=minimo,
                    max_selecoes=maximo,
                    modo_selecao=modo,
                )
                db.add(link)
                links.append(link)
                created.append(f"Regra Quentinha G: {group.nome}")

            desired = {
                "min_selecoes": minimo,
                "max_selecoes": maximo,
                "modo_selecao": modo,
            }
            for field, expected in desired.items():
                current = getattr(link, field)
                if current != expected:
                    changes.append(
                        f"Quentinha G/{group.nome}: {field} {current!r} -> {expected!r}"
                    )
                    setattr(link, field, expected)
            return link

        guarnicoes_link = ensure_rule(
            guarnicoes,
            minimo=0,
            maximo=20,
            modo="porcoes",
        )
        paid_link = ensure_rule(
            paid_group,
            minimo=0,
            maximo=20,
            modo="porcoes",
        )

        db.flush()

        persisted_paid = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == tenant_id,
            OpcaoModificador.grupo_id == paid_group.id,
        ).all()
        persisted_by_name = _options_by_name(persisted_paid, group_name=paid_group.nome)
        for normalized, source in source_by_name.items():
            paid = persisted_by_name.get(normalized)
            if paid is None:
                raise MarmitariaTenant6ConfigError(
                    f"Validação final falhou: adicional {source.nome!r} não foi materializado."
                )
            if _money(paid.preco_adicional) != _paid_price_for_protein(source.nome):
                raise MarmitariaTenant6ConfigError(
                    f"Validação final falhou: preço incorreto para {source.nome!r}."
                )
            if bool(paid.ativo) != bool(source.ativo):
                raise MarmitariaTenant6ConfigError(
                    f"Validação final falhou: disponibilidade divergente para {source.nome!r}."
                )

        if (guarnicoes_link.min_selecoes, guarnicoes_link.max_selecoes, guarnicoes_link.modo_selecao) != (
            0,
            20,
            "porcoes",
        ):
            raise MarmitariaTenant6ConfigError("Validação final falhou na regra de Guarnições.")
        if (paid_link.min_selecoes, paid_link.max_selecoes, paid_link.modo_selecao) != (
            0,
            20,
            "porcoes",
        ):
            raise MarmitariaTenant6ConfigError("Validação final falhou na regra de Adicionais pagos.")

        tenant_options_after = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == tenant_id
        ).count()
        if tenant_options_after < tenant_options_before:
            raise MarmitariaTenant6ConfigError("Violação de segurança: opções foram excluídas.")

        other_groups_after = db.query(GrupoModificador).filter(
            GrupoModificador.restaurante_id != tenant_id
        ).count()
        other_options_after = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id != tenant_id
        ).count()
        other_links_after = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id != tenant_id
        ).count()
        if (
            other_groups_after != other_groups_before
            or other_options_after != other_options_before
            or other_links_after != other_links_before
        ):
            raise MarmitariaTenant6ConfigError(
                "Violação de segurança: dados de outro restaurante foram modificados."
            )

        result = {
            "tenant_id": tenant_id,
            "mode": "apply" if apply else "dry-run",
            "product": {"id": quentinha_g.id, "nome": quentinha_g.nome},
            "paid_group": {"id": paid_group.id, "nome": paid_group.nome},
            "created": created,
            "reused": reused,
            "changes": changes,
            "paid_options": [
                {
                    "nome": option.nome,
                    "preco_adicional": float(_money(option.preco_adicional)),
                    "ativo": bool(option.ativo),
                }
                for option in sorted(persisted_paid, key=lambda item: normalize_catalog_name(item.nome))
            ],
            "rules": {
                "guarnicoes": {"minimo": 0, "maximo": 20, "modo_selecao": "porcoes"},
                "adicionais_pagos": {"minimo": 0, "maximo": 20, "modo_selecao": "porcoes"},
            },
            "confirmacao_nenhuma_exclusao": True,
            "confirmacao_outros_tenants_intactos": True,
        }

        if apply:
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor="marmitaria-tenant6-addons-tool",
                    action="MARMITARIA_PAID_ADDONS_CONFIG",
                    reason=reason,
                    before_data={
                        "product_id": quentinha_g.id,
                        "tenant_options_count": tenant_options_before,
                    },
                    after_data={
                        "paid_group_id": paid_group.id,
                        "created": created,
                        "changes": changes,
                        "rules": result["rules"],
                    },
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
    parser = argparse.ArgumentParser(
        description="Configura adicionais pagos e guarnições livres da Quentinha G do tenant 6."
    )
    parser.add_argument("--tenant-id", type=int, default=6)
    parser.add_argument("--apply", action="store_true", help="Aplica mudanças; sem esta flag executa dry-run.")
    parser.add_argument(
        "--reason",
        default="Go-live Marmitaria tenant 6: adicionais pagos e guarnições livres",
        help="Justificativa persistida na auditoria quando --apply é usado.",
    )
    args = parser.parse_args()
    result = configure_tenant6_addons(
        tenant_id=args.tenant_id,
        apply=args.apply,
        reason=args.reason,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
