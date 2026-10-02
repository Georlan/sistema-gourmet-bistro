"""Script idempotente e tenant-scoped para atualizar o cardápio de sexta-feira da Marmitaria (tenant 6).

Uso:
  python -m tools.update_marmitaria_friday_menu --tenant-id 6
  python -m tools.update_marmitaria_friday_menu --tenant-id 6 --apply --reason "Atualização do cardápio de sexta-feira (02/10/2026)"
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

# Evita que chave pública em SUPABASE_SERVICE_ROLE_KEY bloqueie inicialização do Settings
if os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").startswith("sb_publishable_"):
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""

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
from app.routes.products import ensure_marmitas_available


class MenuUpdateError(RuntimeError):
    pass


def _money(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def update_friday_menu(*, tenant_id: int, apply: bool, reason: str) -> dict[str, Any]:
    if tenant_id != 6:
        raise MenuUpdateError(f"Este script é estritamente restrito ao restaurante id=6 (recebido: {tenant_id}).")

    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        # 1. Guards
        restaurant = (
            db.query(Restaurante)
            .filter(Restaurante.id == tenant_id)
            .with_for_update()
            .one_or_none()
        )
        if restaurant is None:
            raise MenuUpdateError(f"Restaurante {tenant_id} não encontrado.")
        if restaurant.nome != "Quentinha Caseira":
            raise MenuUpdateError(f"Nome inesperado para o restaurante {tenant_id}: {restaurant.nome!r}.")

        profile = (
            db.query(RestauranteOperationProfile)
            .filter(RestauranteOperationProfile.restaurante_id == tenant_id)
            .one_or_none()
        )
        if profile is None or profile.profile_key != "marmitaria":
            raise MenuUpdateError(f"Restaurante {tenant_id} não possui perfil 'marmitaria'.")

        # Contagens de base para validação de segurança
        other_products_before = db.query(Produto).filter(Produto.restaurante_id != tenant_id).count()
        other_options_before = db.query(OpcaoModificador).filter(OpcaoModificador.restaurante_id != tenant_id).count()
        tenant_products_before = db.query(Produto).filter(Produto.restaurante_id == tenant_id).count()
        tenant_options_before = db.query(OpcaoModificador).filter(OpcaoModificador.restaurante_id == tenant_id).count()

        reused: list[str] = []
        created: list[str] = []
        activated: list[str] = []
        paused: list[str] = []
        prices_changed: list[str] = []

        # 2. Definição do Cardápio de Sexta (02/10/2026)
        friday_guarnicoes = [
            "Arroz à grega",
            "Arroz refogado",
            "Baião",
            "Macarrão",
            "Feijão de corda",
            "Farofa",
        ]
        friday_proteinas = [
            "Frango cozido",
            "Costela suína cozida",
            "Filé de frango acebolado",
            "Coxa e sobrecoxa assada",
            "Linguiça",
            "Ovo frito",
        ]
        friday_saladas = [
            "Salada tropical",
            "Verdura de maionese",
            "Salada verde",
            "Vinagrete",
            "Batata-doce",
        ]

        # 3. Resolução dos grupos de modificadores
        groups = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == tenant_id).all()
        g_map = {normalize_catalog_name(g.nome): g for g in groups}

        guarnicoes_group = g_map.get("guarnicoes")
        proteinas_group = g_map.get("proteinas")
        saladas_group = g_map.get("saladas") or g_map.get("saladas-e-verduras")

        if not guarnicoes_group or not proteinas_group or not saladas_group:
            raise MenuUpdateError("Grupos obrigatórios de complementos (Guarnições, Proteínas, Saladas) não encontrados.")

        # Reconciliação dos grupos de opções
        def reconcile_group(group: GrupoModificador, target_names: list[str]) -> None:
            current_options = (
                db.query(OpcaoModificador)
                .filter(
                    OpcaoModificador.restaurante_id == tenant_id,
                    OpcaoModificador.grupo_id == group.id,
                )
                .all()
            )
            opt_by_norm = {normalize_catalog_name(o.nome): o for o in current_options}
            target_norm_set = set()

            for name in target_names:
                norm = normalize_catalog_name(name)
                target_norm_set.add(norm)
                if norm in opt_by_norm:
                    opt = opt_by_norm[norm]
                    reused.append(f"{group.nome}: {opt.nome} (id={opt.id})")
                    if not opt.ativo:
                        opt.ativo = True
                        activated.append(f"{group.nome}: {opt.nome} (id={opt.id})")
                else:
                    new_opt = OpcaoModificador(
                        id=f"opmod-{uuid.uuid4().hex[:8]}",
                        restaurante_id=tenant_id,
                        grupo_id=group.id,
                        nome=name,
                        preco_adicional=Decimal("0.00"),
                        ativo=True,
                    )
                    db.add(new_opt)
                    created.append(f"{group.nome}: {name} (id={new_opt.id})")
                    activated.append(f"{group.nome}: {name} (id={new_opt.id})")

            # Pausar opções do grupo fora do cardápio de sexta
            for norm, opt in opt_by_norm.items():
                if norm not in target_norm_set:
                    if opt.ativo:
                        opt.ativo = False
                        paused.append(f"{group.nome}: {opt.nome} (id={opt.id})")
                    else:
                        paused.append(f"{group.nome}: {opt.nome} (id={opt.id}, mantido inativo)")

        reconcile_group(guarnicoes_group, friday_guarnicoes)
        reconcile_group(proteinas_group, friday_proteinas)
        reconcile_group(saladas_group, friday_saladas)

        # 4. Produtos de Marmitaria (Quentinha P e G)
        products = db.query(Produto).filter(Produto.restaurante_id == tenant_id).all()
        prod_by_size = {p.marmitaria_tamanho: p for p in products if p.marmitaria_tamanho}

        # Quentinha G: R$ 10.00
        p_g = prod_by_size.get("g")
        if not p_g:
            raise MenuUpdateError("Produto Quentinha G não encontrado no restaurante 6.")
        reused.append(f"Produto: {p_g.nome} (tamanho=G, id={p_g.id})")
        if not p_g.ativo:
            p_g.ativo = True
            activated.append(f"Produto: {p_g.nome}")
        if _money(p_g.preco) != _money("10.00"):
            prices_changed.append(f"{p_g.nome}: {_money(p_g.preco)} -> 10.00")
            p_g.preco = _money("10.00")

        # Quentinha P: R$ 7.00
        p_p = prod_by_size.get("p")
        if not p_p:
            raise MenuUpdateError("Produto Quentinha P não encontrado no restaurante 6.")
        reused.append(f"Produto: {p_p.nome} (tamanho=P, id={p_p.id})")
        if not p_p.ativo:
            p_p.ativo = True
            activated.append(f"Produto: {p_p.nome}")
        if _money(p_p.preco) != _money("7.00"):
            prices_changed.append(f"{p_p.nome}: {_money(p_p.preco)} -> 7.00")
            p_p.preco = _money("7.00")

        # 5. Sobremesas
        target_sobremesas = {"Mousse de maracujá": Decimal("6.00")}
        target_sobremesas_norm = {normalize_catalog_name(k): (k, v) for k, v in target_sobremesas.items()}

        sobremesas = [p for p in products if p.categoria_id == "sobremesas"]
        for p in sobremesas:
            p_norm = normalize_catalog_name(p.nome)
            if p_norm in target_sobremesas_norm:
                orig_name, expected_price = target_sobremesas_norm[p_norm]
                reused.append(f"Sobremesa: {p.nome} (id={p.id})")
                if not p.ativo:
                    p.ativo = True
                    activated.append(f"Sobremesa: {p.nome}")
                if _money(p.preco) != _money(expected_price):
                    prices_changed.append(f"Sobremesa {p.nome}: {_money(p.preco)} -> {_money(expected_price)}")
                    p.preco = _money(expected_price)
            else:
                if p.ativo:
                    p.ativo = False
                    paused.append(f"Sobremesa: {p.nome} (id={p.id})")
                else:
                    paused.append(f"Sobremesa: {p.nome} (id={p.id}, mantida inativa)")

        # 6. Sucos (categoria 'bebidas')
        target_sucos = {
            "Acerola": Decimal("7.00"),
            "Goiaba": Decimal("7.00"),
            "Manga": Decimal("7.00"),
        }
        bebidas = [p for p in products if p.categoria_id == "bebidas"]
        matched_bebidas_ids = set()

        for s_name, expected_price in target_sucos.items():
            s_norm = normalize_catalog_name(s_name)
            match = None
            for p in bebidas:
                p_norm = normalize_catalog_name(p.nome)
                if p_norm == s_norm or p_norm == f"suco-de-{s_norm}" or p_norm == f"suco-{s_norm}":
                    match = p
                    break
            if not match:
                raise MenuUpdateError(f"Suco {s_name} não encontrado na categoria bebidas.")
            matched_bebidas_ids.add(match.id)
            reused.append(f"Suco: {match.nome} (id={match.id})")
            if not match.ativo:
                match.ativo = True
                activated.append(f"Suco: {match.nome}")
            if _money(match.preco) != _money(expected_price):
                prices_changed.append(f"Suco {match.nome}: {_money(match.preco)} -> {_money(expected_price)}")
                match.preco = _money(expected_price)

        for p in bebidas:
            if p.id not in matched_bebidas_ids:
                if p.ativo:
                    p.ativo = False
                    paused.append(f"Bebida: {p.nome} (id={p.id})")
                else:
                    paused.append(f"Bebida: {p.nome} (id={p.id}, mantida inativa)")

        # 7. Validação de integridade de Marmitaria (ensure_marmitas_available)
        db.flush()
        active_products = (
            db.query(Produto)
            .filter(Produto.restaurante_id == tenant_id, Produto.ativo.is_(True))
            .all()
        )
        ensure_marmitas_available(db, tenant_id, active_products)

        # 8. Validações finais de segurança
        tenant_products_after = db.query(Produto).filter(Produto.restaurante_id == tenant_id).count()
        tenant_options_after = db.query(OpcaoModificador).filter(OpcaoModificador.restaurante_id == tenant_id).count()
        if tenant_products_after < tenant_products_before:
            raise MenuUpdateError("Violação de segurança: produtos foram excluídos!")
        if tenant_options_after < tenant_options_before:
            raise MenuUpdateError("Violação de segurança: opções foram excluídas!")

        other_products_after = db.query(Produto).filter(Produto.restaurante_id != tenant_id).count()
        other_options_after = db.query(OpcaoModificador).filter(OpcaoModificador.restaurante_id != tenant_id).count()
        if other_products_after != other_products_before or other_options_after != other_options_before:
            raise MenuUpdateError("Violação de segurança: outros restaurantes foram modificados!")

        result = {
            "tenant_id": tenant_id,
            "mode": "apply" if apply else "dry-run",
            "itens_encontrados_reutilizados": reused,
            "itens_novos_criados": created,
            "itens_ativados": activated,
            "itens_pausados": paused,
            "precos_alterados": prices_changed,
            "confirmacao_nenhum_excluido": True,
            "confirmacao_nenhum_outro_restaurante_alterado": True,
        }

        if apply:
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor="marmitaria-friday-menu-tool",
                    action="CATALOG_FRIDAY_UPDATE",
                    reason=reason,
                    before_data={"status": "previous_active_menu"},
                    after_data={
                        "created": created,
                        "activated": activated,
                        "paused": paused,
                        "prices_changed": prices_changed,
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
        description="Atualiza o cardápio de sexta-feira da Marmitaria (tenant 6) de forma segura e idempotente."
    )
    parser.add_argument("--tenant-id", type=int, default=6, help="ID do restaurante (deve ser 6)")
    parser.add_argument("--apply", action="store_true", help="Aplica as alterações no banco (padrão é dry-run)")
    parser.add_argument(
        "--reason",
        default="Atualização do cardápio de sexta-feira (02/10/2026) da Marmitaria",
        help="Justificativa gravada no log de auditoria",
    )
    args = parser.parse_args()

    result = update_friday_menu(
        tenant_id=args.tenant_id,
        apply=args.apply,
        reason=args.reason,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
