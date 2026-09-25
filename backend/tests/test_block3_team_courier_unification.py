"""Testes de regressão do Bloco 3 — Equipe / Entregadores do KÔMA.

Valida a unificação canônica entre Usuario (identidade na equipe) e
Motoboy (perfil operacional de entrega), controle de planos (Pocket, Pro, Premium),
isolamento cross-tenant, cargos e permissões, despacho e preservação histórica.
"""

import random
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Usuario,
    Motoboy,
    MotoboyTokenAtivo,
    Comanda,
    Restaurante,
)
from app.smartpos_models import RestauranteCapability
from app.security import create_access_token

client = TestClient(app)

POCKET_TENANT = 8801
PRO_TENANT = 8802
PREMIUM_TENANT = 8803
TENANT_B = 8804


def _gen_phone():
    return f"1198{random.randint(1000000, 9999999)}"


_order_seq = 1000


def _make_comanda(db, restaurante_id: int, **kwargs) -> Comanda:
    global _order_seq
    _order_seq += 1
    defaults = {
        "id": f"cmd-{uuid.uuid4().hex[:8]}",
        "restaurante_id": restaurante_id,
        "garcom_id": f"admin-{restaurante_id}",
        "numero_pedido": _order_seq,
        "tipo": "Delivery",
        "delivery_status": "pronto",
        "fechada": False,
    }
    defaults.update(kwargs)
    cmd = Comanda(**defaults)
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    return cmd


def _auth_headers(user_id: str, role: str, rest_id: int):
    token = create_access_token(
        subject=user_id,
        restaurante_id=rest_id,
        role=role,
    )
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-ID": str(rest_id),
    }


@pytest.fixture(autouse=True)
def setup_tenants():
    """Configura os restaurantes de teste com seus respectivos planos e administradores."""
    for rid, plano in [
        (POCKET_TENANT, "pocket"),
        (PRO_TENANT, "pro"),
        (PREMIUM_TENANT, "premium"),
        (TENANT_B, "premium"),
    ]:
        token = current_restaurante_id.set(rid)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == rid
                ).delete(synchronize_session=False)

                r = db.query(Restaurante).filter(Restaurante.id == rid).first()
                if not r:
                    r = Restaurante(id=rid, nome=f"Restaurante {rid}", slug=f"rest-{rid}", plano=plano)
                    db.add(r)
                else:
                    r.plano = plano

                admin_id = f"admin-{rid}"
                u_admin = db.query(Usuario).filter(Usuario.id == admin_id).first()
                if not u_admin:
                    u_admin = Usuario(
                        id=admin_id,
                        restaurante_id=rid,
                        nome=f"Admin {rid}",
                        cargo="admin",
                        status="ativo",
                        email=f"admin{rid}@exemplo.com",
                    )
                    db.add(u_admin)
                else:
                    u_admin.status = "ativo"

                db.commit()
        finally:
            current_restaurante_id.reset(token)


def test_1_criar_usuario_motoboy_produz_perfil_operacional():
    """1. Criar Usuario(cargo=motoboy) via Equipe produz e vincula perfil operacional Motoboy."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Carlos Entregador", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res.status_code == 201
    user_data = res.json()
    user_id = user_data["id"]

    with SessionLocal() as db:
        motoboy = db.query(Motoboy).filter(
            Motoboy.restaurante_id == PREMIUM_TENANT,
            Motoboy.usuario_id == user_id,
        ).first()
        assert motoboy is not None, "Perfil operacional Motoboy deve ser criado automaticamente"
        assert motoboy.nome == "Carlos Entregador"
        assert motoboy.telefone == phone
        assert motoboy.ativo is True

    # Aparece em /comandas/motoboys/lista
    res_list = client.get("/comandas/motoboys/lista", headers=headers)
    assert res_list.status_code == 200
    mb_list = res_list.json()
    found = [m for m in mb_list if m["usuario_id"] == user_id]
    assert len(found) == 1
    assert found[0]["nome"] == "Carlos Entregador"


def test_2_bloqueio_duplicata_involuntaria_e_reutilizacao():
    """2. Não permite duplicata operacional involuntária para a mesma identidade."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    # Cadastra na equipe
    res1 = client.post(
        "/caixa/funcionarios",
        json={"nome": "Marcos Silva", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res1.status_code == 201
    user_id = res1.json()["id"]

    # Tentativa de recadastrar na equipe com mesmo telefone dá 409
    res_dup = client.post(
        "/caixa/funcionarios",
        json={"nome": "Outro Marcos", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res_dup.status_code == 409

    # Cadastrar pela área de entregas com o mesmo telefone reutiliza a identidade da equipe
    res_delivery = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Marcos Silva Editado", "telefone": phone, "ativo": True},
        headers=headers,
    )
    assert res_delivery.status_code == 201
    mb_data = res_delivery.json()
    assert mb_data["usuario_id"] == user_id

    # Garante que não existem dois motoboys para o mesmo usuário
    with SessionLocal() as db:
        mbs = db.query(Motoboy).filter(
            Motoboy.restaurante_id == PREMIUM_TENANT,
            Motoboy.usuario_id == user_id,
        ).all()
        assert len(mbs) == 1


def test_3_motoboy_pertence_ao_mesmo_tenant():
    """3. Motoboy pertence estritamente ao mesmo restaurante_id de Usuario."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Lucas Motoboy", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    with SessionLocal() as db:
        u = db.query(Usuario).filter(Usuario.id == user_id).first()
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == user_id).first()
        assert u is not None and mb is not None
        assert u.restaurante_id == PREMIUM_TENANT
        assert mb.restaurante_id == PREMIUM_TENANT
        assert mb.restaurante_id == u.restaurante_id


def test_4_cross_tenant_bloqueado():
    """4. Isolamento cross-tenant completo para perfis e operações de entregador."""
    headers_a = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    headers_b = _auth_headers(f"admin-{TENANT_B}", "admin", TENANT_B)
    phone_b = _gen_phone()

    # Cadastra entregador no Tenant B
    res_b = client.post(
        "/caixa/funcionarios",
        json={"nome": "Entregador Tenant B", "telefone": phone_b, "cargo": "motoboy"},
        headers=headers_b,
    )
    assert res_b.status_code == 201
    user_b_id = res_b.json()["id"]

    with SessionLocal() as db:
        mb_b = db.query(Motoboy).filter(Motoboy.usuario_id == user_b_id).first()
        assert mb_b is not None
        mb_b_id = mb_b.id

    # 1. Tenant A não enxerga entregador de B na listagem
    res_list_a = client.get("/comandas/motoboys/lista", headers=headers_a)
    assert res_list_a.status_code == 200
    ids_a = [m["id"] for m in res_list_a.json()]
    assert mb_b_id not in ids_a

    # 2. Tenant A não gera link para motoboy de B
    res_link_foreign = client.post(f"/comandas/motoboys/{mb_b_id}/gerar-link", headers=headers_a)
    assert res_link_foreign.status_code == 404

    # 3. Tenant A não revoga link de motoboy de B
    res_revoke_foreign = client.post(f"/comandas/motoboys/{mb_b_id}/revogar-link", headers=headers_a)
    assert res_revoke_foreign.status_code == 404

    # 4. Tenant A não despacha pedido usando motoboy de B
    # Cria comanda delivery em A
    with SessionLocal() as db:
        cmd_a = _make_comanda(
            db,
            PREMIUM_TENANT,
            identificador="Cliente A",
        )
        cmd_a_id = cmd_a.id

    res_dispatch_foreign = client.post(
        f"/comandas/{cmd_a_id}/delivery/despachar",
        json={"motoboy_id": mb_b_id},
        headers=headers_a,
    )
    assert res_dispatch_foreign.status_code == 404


def test_5_entregador_inativo_ou_desativado_tem_comportamento_correto():
    """5. Entregador inativo/desativado tem comportamento correto em despacho e PWA."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    # Cadastra entregador
    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Roberto Entrega", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    with SessionLocal() as db:
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == user_id).first()
        mb_id = mb.id

    # Gera link PWA enquanto ativo
    res_link = client.post(f"/comandas/motoboys/{mb_id}/gerar-link", headers=headers)
    assert res_link.status_code == 200
    token = res_link.json()["token"]

    # Desativa o usuário na Equipe
    res_del = client.delete(f"/auth/usuarios/{user_id}", headers=headers)
    assert res_del.status_code == 204

    with SessionLocal() as db:
        mb_ref = db.query(Motoboy).filter(Motoboy.id == mb_id).first()
        assert mb_ref.ativo is False, "Motoboy deve ser inativado ao desativar o usuário"

    # Tentativa de gerar novo link PWA para motoboy inativo retorna 400
    res_link_inactive = client.post(f"/comandas/motoboys/{mb_id}/gerar-link", headers=headers)
    assert res_link_inactive.status_code == 400

    # Token antigo agora é rejeitado no painel PWA
    res_panel = client.get(
        "/comandas/motoboys/painel-entregador",
        headers={"X-Koma-Delivery-Token": token},
    )
    assert res_panel.status_code == 401

    # Tentar despachar pedido com motoboy inativo retorna 404
    with SessionLocal() as db:
        cmd = _make_comanda(
            db,
            PREMIUM_TENANT,
            identificador="Cliente Inativo",
        )
        cmd_id = cmd.id

    res_dispatch_inact = client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=headers,
    )
    assert res_dispatch_inact.status_code == 404


def test_6_cargo_motoboy_reconhecido_pela_matriz_canonica():
    """6. Cargo motoboy é reconhecido pela matriz canônica com label Entregador."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    # Garante ao menos 1 entregador cadastrado
    client.post(
        "/caixa/funcionarios",
        json={"nome": "Entregador Matriz", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )

    res = client.get("/relatorios/cargos-permissoes", headers=headers)
    assert res.status_code == 200
    data = res.json()
    cargos = {c["slug"]: c for c in data.get("cargos", [])}

    assert "motoboy" in cargos, "Cargo 'motoboy' deve estar presente na matriz"
    assert cargos["motoboy"]["label"] == "Entregador"
    assert cargos["motoboy"]["total_funcionarios"] >= 1
    # Permissões do entregador
    perms = cargos["motoboy"]["permissoes"]
    assert perms["pedidos"] is False
    assert perms["caixa"] is False
    assert perms["relatorios"] is False
    assert perms["equipe"] is False
    assert perms["admin"] is False


def test_7_motoboy_nao_recebe_permissoes_administrativas():
    """7. Usuário com cargo motoboy é bloqueado de rotas administrativas e de caixa."""
    headers_admin = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Entregador RBAC", "telefone": phone, "cargo": "motoboy"},
        headers=headers_admin,
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    # Simula autenticação com o usuário motoboy
    headers_motoboy = _auth_headers(user_id, "motoboy", PREMIUM_TENANT)

    # Bloqueado de equipe
    assert client.get("/caixa/funcionarios", headers=headers_motoboy).status_code == 403
    # Bloqueado de relatórios / cargos-permissoes
    assert client.get("/relatorios/cargos-permissoes", headers=headers_motoboy).status_code == 403
    # Bloqueado de configurações administrativas
    assert client.post("/relatorios/meta-mensal", json={"meta_mensal": 5000}, headers=headers_motoboy).status_code == 403


def test_8_e_9_pocket_opera_delivery_sem_pwa():
    """8 e 9. Pocket opera delivery com entregador mas é bloqueado de PWA (courier_app=false)."""
    headers = _auth_headers(f"admin-{POCKET_TENANT}", "admin", POCKET_TENANT)
    phone = _gen_phone()

    # Cadastra entregador na equipe Pocket
    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Entregador Pocket", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    with SessionLocal() as db:
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == user_id).first()
        assert mb is not None
        mb_id = mb.id

        cmd = _make_comanda(
            db,
            POCKET_TENANT,
            identificador="Cliente Pocket",
        )
        cmd_id = cmd.id

    # Pocket consegue despachar pedido com entregador
    res_dispatch = client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=headers,
    )
    assert res_dispatch.status_code == 200
    assert res_dispatch.json()["delivery_status"] == "transito"

    # Pocket NÃO consegue gerar link PWA (403)
    res_link = client.post(f"/comandas/motoboys/{mb_id}/gerar-link", headers=headers)
    assert res_link.status_code == 403

    # Pocket NÃO consegue revogar link PWA (403)
    res_rev = client.post(f"/comandas/motoboys/{mb_id}/revogar-link", headers=headers)
    assert res_rev.status_code == 403


def test_10_e_11_pro_opera_delivery_sem_pwa():
    """10 e 11. Pro opera delivery com entregador mas é bloqueado de PWA."""
    headers = _auth_headers(f"admin-{PRO_TENANT}", "admin", PRO_TENANT)
    phone = _gen_phone()

    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Entregador Pro", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    with SessionLocal() as db:
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == user_id).first()
        mb_id = mb.id

        cmd = _make_comanda(
            db,
            PRO_TENANT,
            identificador="Cliente Pro",
        )
        cmd_id = cmd.id

    # Pro despacha com sucesso
    res_disp = client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=headers,
    )
    assert res_disp.status_code == 200

    # Pro não pode gerar link PWA
    res_link = client.post(f"/comandas/motoboys/{mb_id}/gerar-link", headers=headers)
    assert res_link.status_code == 403


def test_12_premium_opera_com_pwa_fluxo_completo():
    """12. Premium consegue gerar link, carregar painel, confirmar entrega e revogar."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    res = client.post(
        "/caixa/funcionarios",
        json={"nome": "Entregador Premium", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    with SessionLocal() as db:
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == user_id).first()
        mb_id = mb.id

        cmd = _make_comanda(
            db,
            PREMIUM_TENANT,
            identificador="Cliente Premium",
        )
        cmd_id = cmd.id

    # Despacha
    client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=headers,
    )

    # 1. Gera link PWA
    res_link = client.post(f"/comandas/motoboys/{mb_id}/gerar-link", headers=headers)
    assert res_link.status_code == 200
    token = res_link.json()["token"]

    # 2. Carrega painel do entregador
    res_panel = client.get(
        "/comandas/motoboys/painel-entregador",
        headers={"X-Koma-Delivery-Token": token},
    )
    assert res_panel.status_code == 200
    panel_data = res_panel.json()
    assert panel_data["motoboy"]["id"] == mb_id
    assert any(c["id"] == cmd_id for c in panel_data.get("entregas", []))

    # 3. Confirma entrega via PWA
    res_confirm = client.post(
        f"/comandas/motoboys/pedidos/{cmd_id}/confirmar-entrega",
        headers={"X-Koma-Delivery-Token": token},
    )
    assert res_confirm.status_code == 200

    with SessionLocal() as db:
        cmd_conf = db.query(Comanda).filter(Comanda.id == cmd_id).first()
        assert cmd_conf.delivery_status == "finalizado"

    # 4. Revoga link
    res_rev = client.post(f"/comandas/motoboys/{mb_id}/revogar-link", headers=headers)
    assert res_rev.status_code == 200

    # 5. Token revogado não acessa mais o painel
    res_panel_rev = client.get(
        "/comandas/motoboys/painel-entregador",
        headers={"X-Koma-Delivery-Token": token},
    )
    assert res_panel_rev.status_code == 401


def test_13_e_14_override_explicito_courier_app():
    """13 e 14. Override explícito via RestauranteCapability prevalece sobre o plano base."""
    headers_prem = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    headers_pocket = _auth_headers(f"admin-{POCKET_TENANT}", "admin", POCKET_TENANT)

    with SessionLocal() as db:
        # Override 1: Bloquear courier_app em Premium
        db.add(RestauranteCapability(
            restaurante_id=PREMIUM_TENANT,
            capability="courier_app",
            enabled=False,
        ))
        # Override 2: Habilitar courier_app em Pocket
        db.add(RestauranteCapability(
            restaurante_id=POCKET_TENANT,
            capability="courier_app",
            enabled=True,
        ))
        db.commit()

        mb_prem = db.query(Motoboy).filter(Motoboy.restaurante_id == PREMIUM_TENANT, Motoboy.ativo == True).first()
        mb_pocket = db.query(Motoboy).filter(Motoboy.restaurante_id == POCKET_TENANT, Motoboy.ativo == True).first()

    # Premium com courier_app=false falha fechado (403)
    res_prem = client.post(f"/comandas/motoboys/{mb_prem.id}/gerar-link", headers=headers_prem)
    assert res_prem.status_code == 403

    # Pocket com courier_app=true gera link com sucesso (200)
    res_pocket = client.post(f"/comandas/motoboys/{mb_pocket.id}/gerar-link", headers=headers_pocket)
    assert res_pocket.status_code == 200


def test_15_atribuicao_e_despacho_funcionam():
    """15. Atribuição e despacho continuam funcionando perfeitamente."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    res_user = client.post(
        "/caixa/funcionarios",
        json={"nome": "Despacho Fulano", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res_user.status_code == 201

    with SessionLocal() as db:
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == res_user.json()["id"]).first()
        cmd = _make_comanda(
            db,
            PREMIUM_TENANT,
            identificador="Cliente Fluxo",
        )
        cmd_id = cmd.id
        mb_id = mb.id

    res = client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["delivery_status"] == "transito"
    assert data["motoboy_id"] == mb_id


def test_16_pedidos_historicos_com_motoboy_id_continuam_validos():
    """16. Pedidos históricos com motoboy_id continuam válidos e inalterados."""
    with SessionLocal() as db:
        mb = Motoboy(
            restaurante_id=PREMIUM_TENANT,
            nome="Histórico Motoboy",
            telefone="11999990000",
            ativo=True,
        )
        db.add(mb)
        db.flush()

        cmd = _make_comanda(
            db,
            PREMIUM_TENANT,
            delivery_status="finalizado",
            motoboy_id=mb.id,
            fechada=True,
        )
        cmd_id = cmd.id
        mb_id = mb.id

    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    res = client.get(f"/comandas/{cmd_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["motoboy_id"] == mb_id


def test_17_sem_regressao_no_fulfillment_existente():
    """17. Mudança preserva a integridade das transições de status de comanda."""
    headers = _auth_headers(f"admin-{PREMIUM_TENANT}", "admin", PREMIUM_TENANT)
    phone = _gen_phone()

    res_user = client.post(
        "/caixa/funcionarios",
        json={"nome": "Fulfillment Tester", "telefone": phone, "cargo": "motoboy"},
        headers=headers,
    )
    assert res_user.status_code == 201

    # Abre caixa para permitir operações de pedidos
    client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    )

    res_cmd = client.post(
        "/comandas/",
        json={
            "garcom_id": f"admin-{PREMIUM_TENANT}",
            "tipo": "Delivery",
            "identificador": "Cliente Fulfilled",
            "delivery_status": "analise",
            "delivery_telefone": _gen_phone(),
            "delivery_endereco": "Rua das Flores, 123",
            "delivery_taxa": 5.0,
        },
        headers=headers,
    )
    assert res_cmd.status_code == 201
    cmd_id = res_cmd.json()["id"]

    with SessionLocal() as db:
        mb = db.query(Motoboy).filter(Motoboy.usuario_id == res_user.json()["id"]).first()
        mb_id = mb.id

    # Transição: pendente -> producao
    r_prod = client.put(f"/comandas/{cmd_id}/delivery/status?status_novo=producao", headers=headers)
    assert r_prod.status_code == 200
    assert r_prod.json()["delivery_status"] == "producao"

    # Transição: producao -> pronto
    r_pronto = client.put(f"/comandas/{cmd_id}/delivery/status?status_novo=pronto", headers=headers)
    assert r_pronto.status_code == 200
    assert r_pronto.json()["delivery_status"] == "pronto"

    # Despacho: pronto -> transito
    r_disp = client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=headers,
    )
    assert r_disp.status_code == 200
    assert r_disp.json()["delivery_status"] == "transito"
    assert r_disp.json()["motoboy_id"] == mb_id
