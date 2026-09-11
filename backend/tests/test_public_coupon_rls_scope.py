import uuid
from contextlib import contextmanager

from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id, tenant_session_scope
from app.main import app
from app.models import ConfigFidelizacao, Cupom, Restaurante
from app.routes import cupons as cupons_routes


client = TestClient(app)
TENANT_ID = 989


def _seed_public_benefits() -> str:
    code = f"RLS{uuid.uuid4().hex[:8].upper()}"
    db = SessionLocal()
    try:
        with tenant_session_scope(db, TENANT_ID):
            restaurante = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).first()
            if restaurante is None:
                db.add(Restaurante(
                    id=TENANT_ID,
                    nome="Restaurante RLS Público",
                    slug=f"public-rls-{TENANT_ID}",
                ))
                # Garante a FK do tenant antes de inserir configuração/cupom no
                # SQLite do gate. Em produção, o mesmo escopo continua valendo
                # para a nova transação via TenantSession.
                db.commit()

            programa = db.query(ConfigFidelizacao).filter(
                ConfigFidelizacao.restaurante_id == TENANT_ID,
            ).first()
            if programa is None:
                programa = ConfigFidelizacao(restaurante_id=TENANT_ID)
                db.add(programa)
            programa.ativo = True
            programa.tipo_recompensa = "CASHBACK"
            programa.taxa_conversao = 3.0
            programa.valor_ponto_em_dinheiro = 0.02

            db.add(Cupom(
                id=f"cup-rls-{uuid.uuid4().hex[:10]}",
                restaurante_id=TENANT_ID,
                codigo=code,
                tipo_desconto="porcentagem",
                valor_desconto=10.0,
                valor_minimo_pedido=20.0,
                ativo=True,
            ))
            db.commit()
    finally:
        db.close()
    return code


def _record_scope(monkeypatch):
    calls: list[int] = []
    real_scope = tenant_session_scope

    @contextmanager
    def recording_scope(db, restaurante_id):
        calls.append(int(restaurante_id))
        with real_scope(db, int(restaurante_id)) as scoped_id:
            assert current_restaurante_id.get() == TENANT_ID
            yield scoped_id

    monkeypatch.setattr(cupons_routes, "tenant_session_scope", recording_scope)
    return calls


def test_anonymous_public_benefits_bind_tenant_before_rls_queries(monkeypatch):
    code = _seed_public_benefits()
    calls = _record_scope(monkeypatch)

    response = client.get(
        "/cardapio/cupons/beneficios",
        params={"restaurante_id": TENANT_ID},
    )

    assert response.status_code == 200
    assert calls == [TENANT_ID]
    payload = response.json()
    assert payload["programa"] == {
        "ativo": True,
        "tipo_recompensa": "CASHBACK",
        "taxa_conversao": 3.0,
        "valor_ponto_em_dinheiro": 0.02,
    }
    assert code in {coupon["codigo"] for coupon in payload["cupons"]}


def test_anonymous_public_coupon_validation_uses_same_tenant_scope(monkeypatch):
    code = _seed_public_benefits()
    calls = _record_scope(monkeypatch)

    response = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": TENANT_ID,
            "codigo": code,
            "subtotal": 100.0,
        },
    )

    assert response.status_code == 200
    assert calls == [TENANT_ID]
    payload = response.json()
    assert payload["valido"] is True
    assert payload["codigo"] == code
    assert payload["desconto_calculado"] == 10.0
