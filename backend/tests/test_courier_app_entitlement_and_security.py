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
    Item,
    Produto,
    Restaurante,
    Lancamento,
    Categoria,
    CaixaTurno,
    NotificacaoWhatsApp,
)
from app.smartpos_models import RestauranteCapability
from app.security import create_access_token, create_motoboy_token

client = TestClient(app)

POCKET_REST_ID = 7701
PRO_REST_ID = 7702
PREMIUM_REST_ID = 7703
OTHER_REST_ID = 7704


@pytest.fixture(autouse=True)
def setup_tenants_and_users():
    for rid, plano in [
        (POCKET_REST_ID, "pocket"),
        (PRO_REST_ID, "pro"),
        (PREMIUM_REST_ID, "premium"),
        (OTHER_REST_ID, "premium"),
    ]:
        token = current_restaurante_id.set(rid)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == rid
                ).delete(synchronize_session=False)

                r = db.query(Restaurante).filter(Restaurante.id == rid).first()
                if not r:
                    r = Restaurante(id=rid, nome=f"Rest {rid}", slug=f"rest-{rid}", plano=plano)
                    db.add(r)
                else:
                    r.plano = plano

                for role in ["admin", "gerente", "caixa", "garcom"]:
                    uid = f"u-{rid}-{role}"
                    u = db.query(Usuario).filter(Usuario.id == uid).first()
                    if not u:
                        u = Usuario(
                            id=uid,
                            restaurante_id=rid,
                            nome=f"User {role} {rid}",
                            cargo=role,
                            role=role,
                            status="ativo",
                        )
                        db.add(u)
                    else:
                        u.status = "ativo"
                        u.role = role
                        u.cargo = role

                shift = db.query(CaixaTurno).filter(
                    CaixaTurno.restaurante_id == rid,
                    CaixaTurno.status == "aberto",
                ).first()
                if not shift:
                    shift = CaixaTurno(
                        restaurante_id=rid,
                        aberto_por_id=f"u-{rid}-caixa",
                        status="aberto",
                        saldo_inicial=0.0,
                    )
                    db.add(shift)

                db.commit()
        finally:
            current_restaurante_id.reset(token)

    yield

    for rid in [POCKET_REST_ID, PRO_REST_ID, PREMIUM_REST_ID, OTHER_REST_ID]:
        token = current_restaurante_id.set(rid)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == rid
                ).delete(synchronize_session=False)
                db.commit()
        finally:
            current_restaurante_id.reset(token)


def _token_for(rid: int, role: str) -> dict[str, str]:
    token = create_access_token(subject=f"u-{rid}-{role}", restaurante_id=rid, role=role)
    return {"Authorization": f"Bearer {token}"}


def test_motoboy_cadastro_requires_equipe_administrar():
    """garcom não pode cadastrar motoboys; caixa, gerente e admin podem."""
    resp = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto 1", "telefone": "81999990001"},
        headers=_token_for(POCKET_REST_ID, "garcom"),
    )
    assert resp.status_code == 403

    resp = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto 2", "telefone": "81999990002"},
        headers=_token_for(POCKET_REST_ID, "caixa"),
    )
    assert resp.status_code == 201
    assert resp.json()["nome"] == "Moto 2"


def test_motoboy_list_tenant_isolation():
    """Listar motoboys retorna apenas os motoboys do próprio restaurante."""
    resp1 = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Pocket", "telefone": "81999991111"},
        headers=_token_for(POCKET_REST_ID, "admin"),
    )
    assert resp1.status_code == 201
    mb_pocket_id = resp1.json()["id"]

    resp2 = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Other", "telefone": "81999992222"},
        headers=_token_for(OTHER_REST_ID, "admin"),
    )
    assert resp2.status_code == 201
    mb_other_id = resp2.json()["id"]

    list_pocket = client.get(
        "/comandas/motoboys/lista",
        headers=_token_for(POCKET_REST_ID, "garcom"),
    )
    assert list_pocket.status_code == 200
    pocket_ids = [m["id"] for m in list_pocket.json()]
    assert mb_pocket_id in pocket_ids
    assert mb_other_id not in pocket_ids

    list_other = client.get(
        "/comandas/motoboys/lista",
        headers=_token_for(OTHER_REST_ID, "garcom"),
    )
    assert list_other.status_code == 200
    other_ids = [m["id"] for m in list_other.json()]
    assert mb_other_id in other_ids
    assert mb_pocket_id not in other_ids


def test_gerar_link_entitlement_gating():
    """gerar-link é restrito a Premium ou com capability courier_app."""
    res = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Pocket Test", "telefone": "81999993333"},
        headers=_token_for(POCKET_REST_ID, "admin"),
    )
    mb_id = res.json()["id"]

    resp = client.post(
        f"/comandas/motoboys/{mb_id}/gerar-link",
        headers=_token_for(POCKET_REST_ID, "admin"),
    )
    assert resp.status_code == 403
    assert "App do Entregador" in resp.json()["detail"]

    res_pro = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Pro Test", "telefone": "81999994444"},
        headers=_token_for(PRO_REST_ID, "admin"),
    )
    mb_pro_id = res_pro.json()["id"]

    resp_pro = client.post(
        f"/comandas/motoboys/{mb_pro_id}/gerar-link",
        headers=_token_for(PRO_REST_ID, "admin"),
    )
    assert resp_pro.status_code == 403
    assert "App do Entregador" in resp_pro.json()["detail"]

    res_prem = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Premium Test", "telefone": "81999995555"},
        headers=_token_for(PREMIUM_REST_ID, "admin"),
    )
    mb_prem_id = res_prem.json()["id"]

    resp_prem = client.post(
        f"/comandas/motoboys/{mb_prem_id}/gerar-link",
        headers=_token_for(PREMIUM_REST_ID, "admin"),
    )
    assert resp_prem.status_code == 200
    assert "token" in resp_prem.json()
    assert "/entregador#token=" in resp_prem.json()["link"]

    resp_garcom = client.post(
        f"/comandas/motoboys/{mb_prem_id}/gerar-link",
        headers=_token_for(PREMIUM_REST_ID, "garcom"),
    )
    assert resp_garcom.status_code == 403


def test_capability_override_allows_pocket_and_revokes_premium():
    """RestauranteCapability(capability='courier_app') sobrepõe o plano base."""
    token = current_restaurante_id.set(POCKET_REST_ID)
    try:
        with SessionLocal() as db:
            cap = RestauranteCapability(
                restaurante_id=POCKET_REST_ID,
                capability="courier_app",
                enabled=True,
                source="addon",
            )
            db.add(cap)
            db.commit()
    finally:
        current_restaurante_id.reset(token)

    res = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Pocket Addon", "telefone": "81999996666"},
        headers=_token_for(POCKET_REST_ID, "admin"),
    )
    mb_id = res.json()["id"]

    resp = client.post(
        f"/comandas/motoboys/{mb_id}/gerar-link",
        headers=_token_for(POCKET_REST_ID, "admin"),
    )
    assert resp.status_code == 200
    assert "token" in resp.json()

    token_prem = current_restaurante_id.set(PREMIUM_REST_ID)
    try:
        with SessionLocal() as db:
            cap_rev = RestauranteCapability(
                restaurante_id=PREMIUM_REST_ID,
                capability="courier_app",
                enabled=False,
                source="manual",
            )
            db.add(cap_rev)
            db.commit()
    finally:
        current_restaurante_id.reset(token_prem)

    res_prem = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Premium Revoked", "telefone": "81999997777"},
        headers=_token_for(PREMIUM_REST_ID, "admin"),
    )
    mb_prem_id = res_prem.json()["id"]

    resp_prem = client.post(
        f"/comandas/motoboys/{mb_prem_id}/gerar-link",
        headers=_token_for(PREMIUM_REST_ID, "admin"),
    )
    assert resp_prem.status_code == 403


def test_painel_entregador_and_confirmar_entrega_enforce_entitlement():
    """Driver endpoints (painel e confirmação) validam o entitlement do restaurante."""
    jti_prem = str(uuid.uuid4())
    jti_pocket = str(uuid.uuid4())

    token1 = current_restaurante_id.set(PREMIUM_REST_ID)
    try:
        with SessionLocal() as db:
            mb_prem = db.query(Motoboy).filter(Motoboy.id == 9101, Motoboy.restaurante_id == PREMIUM_REST_ID).first()
            if not mb_prem:
                mb_prem = Motoboy(id=9101, restaurante_id=PREMIUM_REST_ID, nome="Driver Prem", telefone="81999998881", ativo=True)
                db.add(mb_prem)
            tok_prem_db = MotoboyTokenAtivo(jti=jti_prem, motoboy_id=9101, restaurante_id=PREMIUM_REST_ID, revogado=False)
            db.add(tok_prem_db)
            db.commit()
    finally:
        current_restaurante_id.reset(token1)

    token2 = current_restaurante_id.set(POCKET_REST_ID)
    try:
        with SessionLocal() as db:
            mb_pocket = db.query(Motoboy).filter(Motoboy.id == 9102, Motoboy.restaurante_id == POCKET_REST_ID).first()
            if not mb_pocket:
                mb_pocket = Motoboy(id=9102, restaurante_id=POCKET_REST_ID, nome="Driver Pocket", telefone="81999998882", ativo=True)
                db.add(mb_pocket)
            tok_pocket_db = MotoboyTokenAtivo(jti=jti_pocket, motoboy_id=9102, restaurante_id=POCKET_REST_ID, revogado=False)
            db.add(tok_pocket_db)
            db.commit()
    finally:
        current_restaurante_id.reset(token2)

    token_prem = create_motoboy_token(motoboy_id=9101, restaurante_id=PREMIUM_REST_ID, jti=jti_prem)
    token_pocket = create_motoboy_token(motoboy_id=9102, restaurante_id=POCKET_REST_ID, jti=jti_pocket)

    # Painel para restaurante Premium -> 200 OK
    resp_prem = client.get(
        "/comandas/motoboys/painel-entregador",
        headers={"X-Koma-Delivery-Token": token_prem},
    )
    assert resp_prem.status_code == 200

    # Painel para restaurante Pocket -> 403 Forbidden
    resp_pocket = client.get(
        "/comandas/motoboys/painel-entregador",
        headers={"X-Koma-Delivery-Token": token_pocket},
    )
    assert resp_pocket.status_code == 403
    assert "App do Entregador" in resp_pocket.json()["detail"]


def test_delivery_dispatch_operational_flow_preserved_on_pocket():
    """Despacho no Pocket/Pro funciona normalmente sem vazar o PWA."""
    # 1. Cadastrar Motoboy
    mb_res = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Pocket Ops", "telefone": "81999999991"},
        headers=_token_for(POCKET_REST_ID, "caixa"),
    )
    assert mb_res.status_code == 201
    mb_id = mb_res.json()["id"]

    # 2. Criar comanda de delivery via API
    comanda_payload = {
        "mesa_id": None,
        "garcom_id": f"u-{POCKET_REST_ID}-caixa",
        "tipo": "Delivery",
        "identificador": "Cliente Pocket",
        "delivery_status": "analise",
        "delivery_telefone": "81988881111",
        "delivery_endereco": "Rua Teste, 42",
        "delivery_taxa": 5.0,
    }
    create_res = client.post(
        "/comandas/",
        json=comanda_payload,
        headers=_token_for(POCKET_REST_ID, "caixa"),
    )
    assert create_res.status_code == 201
    cmd_id = create_res.json()["id"]

    # 3. Transicionar: analise -> producao -> pronto
    stat1 = client.put(
        f"/comandas/{cmd_id}/delivery/status?status_novo=producao",
        headers=_token_for(POCKET_REST_ID, "caixa"),
    )
    assert stat1.status_code == 200

    stat2 = client.put(
        f"/comandas/{cmd_id}/delivery/status?status_novo=pronto",
        headers=_token_for(POCKET_REST_ID, "caixa"),
    )
    assert stat2.status_code == 200

    # 4. Despachar com Motoboy
    resp = client.post(
        f"/comandas/{cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_id},
        headers=_token_for(POCKET_REST_ID, "caixa"),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["delivery_status"] == "transito"
    assert data["motoboy_id"] == mb_id

    # 5. Verificar que NENHUM token PWA foi gerado para o motoboy no Pocket
    token = current_restaurante_id.set(POCKET_REST_ID)
    try:
        with SessionLocal() as db:
            active_tokens = db.query(MotoboyTokenAtivo).filter(
                MotoboyTokenAtivo.restaurante_id == POCKET_REST_ID,
                MotoboyTokenAtivo.motoboy_id == mb_id,
            ).count()
            assert active_tokens == 0

            notif = db.query(NotificacaoWhatsApp).filter(
                NotificacaoWhatsApp.restaurante_id == POCKET_REST_ID,
                NotificacaoWhatsApp.comanda_id == cmd_id,
                NotificacaoWhatsApp.tipo == "atribuicao_motoboy",
            ).first()
            assert notif is not None
    finally:
        current_restaurante_id.reset(token)

    # 6. Despachar no Premium: gera token ativo do PWA
    mb_prem_res = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Moto Premium Ops", "telefone": "81999999992"},
        headers=_token_for(PREMIUM_REST_ID, "caixa"),
    )
    assert mb_prem_res.status_code == 201
    mb_prem_id = mb_prem_res.json()["id"]

    prem_comanda_payload = {
        "mesa_id": None,
        "garcom_id": f"u-{PREMIUM_REST_ID}-caixa",
        "tipo": "Delivery",
        "identificador": "Cliente Premium",
        "delivery_status": "analise",
        "delivery_telefone": "81988882222",
        "delivery_endereco": "Av Boa Viagem, 100",
        "delivery_taxa": 7.0,
    }
    prem_create_res = client.post(
        "/comandas/",
        json=prem_comanda_payload,
        headers=_token_for(PREMIUM_REST_ID, "caixa"),
    )
    assert prem_create_res.status_code == 201
    prem_cmd_id = prem_create_res.json()["id"]

    client.put(
        f"/comandas/{prem_cmd_id}/delivery/status?status_novo=producao",
        headers=_token_for(PREMIUM_REST_ID, "caixa"),
    )
    client.put(
        f"/comandas/{prem_cmd_id}/delivery/status?status_novo=pronto",
        headers=_token_for(PREMIUM_REST_ID, "caixa"),
    )

    prem_disp_res = client.post(
        f"/comandas/{prem_cmd_id}/delivery/despachar",
        json={"motoboy_id": mb_prem_id},
        headers=_token_for(PREMIUM_REST_ID, "caixa"),
    )
    assert prem_disp_res.status_code == 200

    token_prem = current_restaurante_id.set(PREMIUM_REST_ID)
    try:
        with SessionLocal() as db:
            active_tokens_prem = db.query(MotoboyTokenAtivo).filter(
                MotoboyTokenAtivo.restaurante_id == PREMIUM_REST_ID,
                MotoboyTokenAtivo.motoboy_id == mb_prem_id,
                MotoboyTokenAtivo.revogado == False,
            ).count()
            assert active_tokens_prem == 1
    finally:
        current_restaurante_id.reset(token_prem)
