"""Regressões de redução da superfície pública (RT-05, RT-07, RT-08, RT-10)."""

from __future__ import annotations

import os
import subprocess
import sys

from fastapi.testclient import TestClient

from app.main import app


def test_production_mode_disables_openapi_docs_and_hides_health_diagnostics():
    code = (
        "import os; "
        "os.environ['ENVIRONMENT']='production'; "
        "os.environ['DATABASE_URL']='sqlite:///:memory:'; "
        "os.environ['MIGRATION_DATABASE_URL']='sqlite:///:memory:'; "
        "os.environ['SECRET_KEY']='prod-audit-secret-key-0123456789abcdef'; "
        "os.environ['ENCRYPTION_KEY']='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; "
        "from fastapi.testclient import TestClient; "
        "from app.main import app; "
        "c = TestClient(app); "
        "assert c.get('/docs').status_code == 404; "
        "assert c.get('/redoc').status_code == 404; "
        "assert c.get('/openapi.json').status_code == 404; "
        "root = c.get('/'); assert root.status_code == 200 and 'docs' not in root.json(); "
        "h = c.get('/health'); assert h.status_code == 200 and set(h.json().keys()) == {'status', 'database'}; "
        "hr = c.get('/health/ready'); assert hr.status_code == 200 and set(hr.json().keys()) == {'status', 'database'}; "
        "print('PROD_SURFACE_OK')"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env={**os.environ, "ENVIRONMENT": "production"},
        check=False,
    )
    assert proc.returncode == 0, f"stdout={proc.stdout}\nstderr={proc.stderr}"
    assert "PROD_SURFACE_OK" in proc.stdout


def test_super_admin_health_diagnostics_requires_superadmin():
    with TestClient(app) as client:
        assert client.get("/api/super-admin/health/diagnostics").status_code == 401


def test_public_coupon_and_modifier_endpoints_return_controlled_4xx_for_invalid_tenant():
    with TestClient(app) as client:
        r_cupom = client.get("/cardapio/cupons/beneficios?restaurante_id=0")
        assert r_cupom.status_code == 422

        r_cupom_neg = client.get("/cardapio/cupons/beneficios?restaurante_id=-5")
        assert r_cupom_neg.status_code == 422

        r_mod = client.get("/cardapio/modificadores/publico/0")
        assert r_mod.status_code == 422

        r_mod_missing = client.get("/cardapio/modificadores/publico/999999")
        assert r_mod_missing.status_code == 404


def test_leads_endpoint_does_not_expose_deduplication_oracle_on_repeat():
    payload = {
        "nome": "Lead Anti-Oracle",
        "whatsapp": "85977776666",
        "empresa_nome": "Bistro Anti-Oracle",
        "consent_whatsapp": True,
    }
    with TestClient(app) as client:
        r1 = client.post("/api/leads/landing", json=payload)
        assert r1.status_code == 201
        r2 = client.post("/api/leads/landing", json=payload)
        assert r2.status_code == 201
        body2 = r2.json()
        assert body2 == {"success": True, "message": "Contato recebido ✓"}
        assert "deduplicated" not in body2
        assert "lead_id" not in body2
        assert "signup_url" not in body2
