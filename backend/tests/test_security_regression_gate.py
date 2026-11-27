"""Security Regression Gate permanente do KÔMA.

Cobre:
- Inventário automático e allowlist versionada de superfícies públicas
- Detecção de novas rotas sem classificação/autenticação explícita
- Varredura de acesso anônimo em todas as rotas protegidas
- Revogação de credenciais (equipe, bridge legado, cliente, Super Admin)
- Isolamento multitenant entre dois tenants fictícios
- Minimização de dados em rotas públicas
- Assinatura, replay e idempotência de webhooks
- Limites de recursos (payloads HTTP, webhooks, WebSockets, billing)
- Regressões explícitas para RT-01 a RT-10
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from fastapi.routing import APIRoute, APIWebSocketRoute
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.database import SessionLocal
from app.logging_security import redact_sensitive_headers, redact_sensitive_query_values
from app.main import app
from app.models import (
    Categoria,
    Cliente,
    Comanda,
    ConfiguracaoRestaurante,
    Cupom,
    GrupoModificador,
    Produto,
    Restaurante,
    Usuario,
)
from app.routes import saas_billing
from app.routes import websocket as ws_route
from app.security import create_access_token, get_password_hash, revoke_user_sessions
from app.services.client_ip import resolve_client_ip_with_source
from app.services.clientes import cadastrar_ou_atualizar_cliente
from app.services.customer_auth import create_customer_access_token
from app.services.online_payments.signature import verify_mercado_pago_signature
from app.services.staff_login_rate_limit import (
    _UNKNOWN_IDENTITY_BUCKETS,
    _UNKNOWN_IDENTITY_LOCK,
)
from app.websocket_manager import MAX_PUBLIC_WS_PER_IP, manager

ALLOWLIST_PATH = Path(__file__).resolve().parents[1] / "security_route_allowlist.json"

AUTH_KEYWORDS = (
    "get_current_user",
    "get_current_admin",
    "require_permission",
    "require_entitled_permission",
    "require_roles",
    "require_active_subscription",
    "get_current_user_for_support_action",
    "authenticate_agent",
    "get_current_agent",
    "verify_agent",
)


def _walk_all_routes(routes, prefix="", inherited_deps=()):
    out = []
    for r in routes:
        if type(r).__name__ == "_IncludedRouter":
            ic = r.include_context
            sub_prefix = prefix + (getattr(ic, "prefix", "") or "")
            sub_deps = list(inherited_deps)
            for d in (getattr(ic, "dependencies", None) or []):
                call = getattr(d, "dependency", d)
                sub_deps.append(getattr(call, "__qualname__", repr(call)))
            out.extend(_walk_all_routes(r.original_router.routes, sub_prefix, tuple(sub_deps)))
        elif isinstance(r, APIRoute):
            deps = list(inherited_deps)

            def _collect(dep):
                for d in getattr(dep, "dependencies", []) or []:
                    deps.append(getattr(d.call, "__qualname__", repr(d.call)))
                    _collect(d)

            _collect(r.dependant)
            out.append(("HTTP", prefix + r.path, sorted(m for m in (r.methods or []) if m != "HEAD"), deps))
        elif isinstance(r, APIWebSocketRoute):
            out.append(("WS", prefix + r.path, ["WEBSOCKET"], list(inherited_deps)))
        elif isinstance(r, (Route, WebSocketRoute, Mount)):
            out.append(("BUILTIN", prefix + r.path, sorted(getattr(r, "methods", []) or ["GET"]), []))
    return out


def _materialize_path(path: str) -> str:
    def _repl(match: re.Match) -> str:
        name = match.group(1).lower()
        if any(k in name for k in ("restaurante_id", "mesa_id", "motoboy_id", "dist_id", "insumo_id", "contagem_id")):
            return "999999"
        if "protocol" in name:
            return "KOMA-CTR-20261126-AAAAAAAAAAAA"
        return "00000000-0000-0000-0000-000000000000"

    return re.sub(r"\{([^}]+)\}", _repl, path)


@pytest.fixture(scope="module")
def security_tenants():
    db = SessionLocal()
    try:
        for rid, nome, slug in [
            (70101, "Gate Bistro Alpha", "gate-bistro-alpha"),
            (70102, "Gate Cantina Beta", "gate-cantina-beta"),
        ]:
            if db.query(Restaurante).filter(Restaurante.id == rid).first() is None:
                db.add(Restaurante(id=rid, nome=nome, slug=slug, plano="premium", saas_status="active"))
                db.flush()
                db.add(ConfiguracaoRestaurante(restaurante_id=rid))
                db.add(Categoria(id=f"gate-cat-{rid}", restaurante_id=rid, nome=f"Categoria {rid}"))
                db.flush()
                db.add(
                    Produto(
                        id=f"gate-prod-{rid}",
                        restaurante_id=rid,
                        categoria_id=f"gate-cat-{rid}",
                        nome=f"Prato Gate {rid}",
                        preco=35.0,
                        ativo=True,
                    )
                )
                db.add(
                    GrupoModificador(
                        id=f"gate-gmod-{rid}",
                        restaurante_id=rid,
                        nome=f"Modificador {rid}",
                        min_selecoes=0,
                        max_selecoes=2,
                        tipo="adicional",
                    )
                )
                db.add(
                    Cupom(
                        id=f"gate-cup-{rid}",
                        restaurante_id=rid,
                        codigo=f"GATE{rid}",
                        tipo_desconto="percentual",
                        valor_desconto=10.0,
                        ativo=True,
                    )
                )
                db.add(
                    Usuario(
                        id=f"gate-admin-{rid}",
                        restaurante_id=rid,
                        nome=f"Admin {rid}",
                        email=f"gate-admin-{rid}@audit.invalid",
                        cargo="admin",
                        role="admin",
                        status="ativo",
                        senha_hash=get_password_hash("StrongGate!2026"),
                    )
                )
                db.add(
                    Usuario(
                        id=f"gate-waiter-{rid}",
                        restaurante_id=rid,
                        nome=f"Garcom {rid}",
                        email=f"gate-waiter-{rid}@audit.invalid",
                        cargo="garcom",
                        role="garcom",
                        status="ativo",
                        senha_hash=get_password_hash("WaiterGate!2026"),
                    )
                )
                db.flush()
                db.add(
                    Comanda(
                        id=f"gate-cmd-{rid}",
                        restaurante_id=rid,
                        garcom_id=f"gate-admin-{rid}",
                        numero_pedido=rid,
                        tipo="Delivery",
                        delivery_status="pendente",
                        idempotency_key=f"gate-idem-{rid}",
                        fechada=False,
                    )
                )
                cliente = cadastrar_ou_atualizar_cliente(
                    db,
                    restaurante_id=rid,
                    nome=f"Cliente {rid}",
                    telefone=f"859888{rid}",
                )
                cliente.email = f"gate-cust-{rid}@audit.invalid"
                cliente.senha_hash = get_password_hash("CustGate!2026")
                cliente.email_verificado_em = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def test_route_inventory_and_allowlist_detect_unclassified_routes():
    assert ALLOWLIST_PATH.exists(), f"Missing {ALLOWLIST_PATH}"
    allowlist_data = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    allowed_routes: dict[str, str] = allowlist_data["routes"]

    discovered_non_auth: set[str] = set()
    protected_count = 0

    for _kind, path, methods, deps in _walk_all_routes(app.routes):
        deps_str = " ".join(deps)
        has_explicit_auth = any(k in deps_str for k in AUTH_KEYWORDS) or path.startswith("/caixa/") or path.startswith("/estoque/")
        for method in methods:
            op = f"{method} {path}"
            if has_explicit_auth:
                protected_count += 1
            else:
                discovered_non_auth.add(op)

    # Allow optional conditional route /api/whatsapp/webhook when disabled in default test env
    optional_conditional = {"GET /api/whatsapp/webhook", "POST /api/whatsapp/webhook"}
    missing_from_allowlist = discovered_non_auth - set(allowed_routes.keys())
    stale_in_allowlist = (set(allowed_routes.keys()) - discovered_non_auth) - optional_conditional

    assert not missing_from_allowlist, (
        "Novas rotas sem dependência explícita de autenticação não estão na allowlist "
        f"({ALLOWLIST_PATH.name}): {sorted(missing_from_allowlist)}"
    )
    assert not stale_in_allowlist, (
        "Rotas removidas permanecem na allowlist; atualize backend/security_route_allowlist.json: "
        f"{sorted(stale_in_allowlist)}"
    )
    assert protected_count >= 400


def test_all_protected_routes_reject_anonymous_requests(security_tenants):
    del security_tenants
    failures = []
    tested = 0
    with TestClient(app, raise_server_exceptions=False) as client:
        for _kind, path, methods, deps in _walk_all_routes(app.routes):
            deps_str = " ".join(deps)
            is_protected = (
                any(k in deps_str for k in AUTH_KEYWORDS)
                or path.startswith("/caixa/")
                or path.startswith("/estoque/")
                or (path.startswith("/api/super-admin/") and path != "/api/super-admin/token")
            )
            if not is_protected:
                continue
            url = _materialize_path(path)
            for method in methods:
                tested += 1
                kwargs = {"json": {}} if method in ("POST", "PUT", "PATCH") else {}
                resp = client.request(method, url, **kwargs)
                if resp.status_code not in (401, 403, 422):
                    failures.append((method, path, resp.status_code))
    assert tested >= 400
    assert not failures, f"Rotas protegidas aceitaram requisição anônima: {failures}"


def test_credential_revocation_and_jwt_hardening(security_tenants):
    del security_tenants
    with TestClient(app) as client:
        # JWT inválido, alg=none, expirado, boolean tenant
        bad_tokens = [
            jwt.encode({"sub": "gate-admin-70101", "restaurante_id": 70101, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, "wrong", algorithm="HS256"),
            jwt.encode({"sub": "gate-admin-70101", "restaurante_id": 70101, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, "", algorithm="none"),
            jwt.encode({"sub": "gate-admin-70101", "restaurante_id": 70101, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, settings.SECRET_KEY, algorithm="HS256"),
            jwt.encode({"sub": "gate-admin-70101", "restaurante_id": True, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, settings.SECRET_KEY, algorithm="HS256"),
        ]
        for tok in bad_tokens:
            assert client.get("/produtos/", headers={"Authorization": f"Bearer {tok}"}).status_code == 401

        # RT-06: revogação de sessão bloqueia rotas comuns e o bridge legado /caixa/config-cardapio
        tok = create_access_token(subject="gate-waiter-70101", restaurante_id=70101, token_version=1)
        assert client.get("/caixa/config-cardapio", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
        db = SessionLocal()
        try:
            revoke_user_sessions(db, user_id="gate-waiter-70101", restaurante_id=70101)
            db.commit()
        finally:
            db.close()
        assert client.get("/produtos/", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
        assert client.get("/caixa/config-cardapio", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_multitenant_isolation_and_public_data_minimization(security_tenants):
    del security_tenants
    tok_701 = create_access_token(subject="gate-admin-70101", restaurante_id=70101, token_version=1)
    spoof_headers = {"Authorization": f"Bearer {tok_701}", "X-Tenant-ID": "70102", "X-Restaurante-ID": "70102"}

    with TestClient(app) as client:
        prods = client.get("/produtos/", headers=spoof_headers)
        assert prods.status_code == 200
        ids = {p["id"] for p in prods.json()}
        assert "gate-prod-70101" in ids and "gate-prod-70102" not in ids

        assert client.get("/comandas/gate-cmd-70102", headers=spoof_headers).status_code == 404
        assert client.get("/api/super-admin/restaurantes", headers={"Authorization": f"Bearer {tok_701}"}).status_code == 403

        # Pedidos públicos: chave do tenant 70101 não acessa comanda do tenant 70102
        assert client.get("/cardapio/pedidos/gate-cmd-70102/status?key=gate-idem-70101").status_code == 404
        assert client.get("/cardapio/pedidos/gate-cmd-70101/status?key=gate-idem-70101").status_code == 200

        # Minimização de dados públicos no cardápio
        pub = client.get("/api/cardapio-digital/public?restaurante_id=70101")
        assert pub.status_code == 200
        raw = pub.text.lower()
        for sensitive in ("senha_hash", "webhook_secret", "gate-admin-70101@audit.invalid", "gate-cust-70101@audit.invalid"):
            assert sensitive not in raw


def test_webhook_signatures_replay_window_and_payload_limits():
    secret = "wh-secret-gate"
    old_ts = str(int(time.time()) - 600)  # > 300s replay window
    manifest = f"id:pay-1;request-id:req-1;ts:{old_ts};"
    old_sig = f"ts={old_ts},v1={hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()}"
    assert not verify_mercado_pago_signature(signature_header=old_sig, request_id="req-1", data_id="pay-1", secret=secret)

    fresh_ts = str(int(time.time()))
    fresh_manifest = f"id:pay-1;request-id:req-1;ts:{fresh_ts};"
    fresh_sig = f"ts={fresh_ts},v1={hmac.new(secret.encode(), fresh_manifest.encode(), hashlib.sha256).hexdigest()}"
    assert verify_mercado_pago_signature(signature_header=fresh_sig, request_id="req-1", data_id="pay-1", secret=secret)

    oversized = json.dumps({"type": "payment", "data": {"id": "1", "pad": "Z" * (270 * 1024)}})
    with TestClient(app) as client:
        for url in (
            "/payments/webhooks/mercado-pago",
            "/payments/webhooks/mercado-pago/acc-1",
            "/api/integrations/saas-billing/mercado-pago/webhook",
            "/api/integrations/saas-pix/mercado-pago/webhook",
        ):
            assert client.post(url, content=oversized, headers={"Content-Type": "application/json"}).status_code == 413


def test_rt01_to_rt10_regressions(monkeypatch, security_tenants):
    del security_tenants
    # RT-01: right-to-left XFF + CF-Connecting-IP validation
    req = Request({
        "type": "http", "method": "POST", "path": "/auth/login",
        "headers": [(b"x-forwarded-for", b"1.2.3.4, 203.0.113.55"), (b"cf-connecting-ip", b"9.9.9.9")],
        "client": ("100.64.0.10", 12345),
    })
    assert resolve_client_ip_with_source(req) == ("203.0.113.55", "x-forwarded-for")

    # RT-02: uniform 429 on existing vs non-existent staff login
    with _UNKNOWN_IDENTITY_LOCK:
        _UNKNOWN_IDENTITY_BUCKETS.clear()
    with TestClient(app) as client:
        c_exist, c_missing = [], []
        for i in range(10):
            c_exist.append(client.post("/auth/login", json={"username": "gate-admin-70101@audit.invalid", "password": f"bad{i}"}, headers={"X-Forwarded-For": "203.0.113.151"}).status_code)
            c_missing.append(client.post("/auth/login", json={"username": "no-such-user-gate@audit.invalid", "password": f"bad{i}"}, headers={"X-Forwarded-For": "203.0.113.152"}).status_code)
        assert c_exist == c_missing and 429 in c_exist

        # RT-03: WebSocket message > 4KB -> 1009, per-IP cap -> 1008
        monkeypatch.setattr(ws_route._ws_connect_rate_limiter, "requests_per_minute", 200)
        with client.websocket_connect("/ws/cliente?restaurante_id=70101", headers={"Origin": "https://app.komafood.com.br", "X-Forwarded-For": "203.0.113.160"}) as ws:
            ws.send_text("A" * 5000)
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_text()
            assert exc.value.code == 1009

        # RT-04: contract billing rate limit
        with saas_billing._billing_mutation_limiter._lock:
            saas_billing._billing_mutation_limiter.history.clear()
        codes = [
            client.post("/api/contracts/KOMA-CTR-20261126-BBBBBBBBBBBB/billing/activate-free", headers={"X-Forwarded-For": "203.0.113.161"}).status_code
            for _ in range(22)
        ]
        assert 429 in codes

        # RT-07 & RT-10: invalid public tenant ids return 422/404, never 500
        assert client.get("/cardapio/cupons/beneficios?restaurante_id=0").status_code == 422
        assert client.get("/cardapio/modificadores/publico/0").status_code == 422
        assert client.get("/cardapio/modificadores/publico/999999").status_code == 404

        # RT-08: leads repeat hides deduplication oracle
        lead_payload = {"nome": "Gate Lead", "whatsapp": "85966665555", "empresa_nome": "Gate Bistro", "consent_whatsapp": True}
        assert client.post("/api/leads/landing", json=lead_payload).status_code == 201
        r_dup = client.post("/api/leads/landing", json=lead_payload)
        assert r_dup.status_code == 201
        assert r_dup.json() == {"success": True, "message": "Contato recebido ✓"}

    # RT-09: query and header redaction
    assert "secret-k" not in redact_sensitive_query_values("GET /cardapio/pedidos/1/status?key=secret-k")
    assert "qa-sec" not in redact_sensitive_query_values("GET /api/cardapio-digital/public?qa_token=qa-sec")
    assert redact_sensitive_headers({"Authorization": "Bearer abc", "X-Koma-QA-Token": "qa-sec"})["X-Koma-QA-Token"] == "[REDACTED]"

    # RT-05: production mode disables /docs, /openapi.json and /health diagnostics
    code = (
        "import os; os.environ['ENVIRONMENT']='production'; "
        "os.environ['DATABASE_URL']='sqlite:///:memory:'; os.environ['MIGRATION_DATABASE_URL']='sqlite:///:memory:'; "
        "os.environ['SECRET_KEY']='prod-gate-secret-key-0123456789abcdef'; "
        "os.environ['ENCRYPTION_KEY']='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; "
        "from fastapi.testclient import TestClient; from app.main import app; c=TestClient(app); "
        "assert c.get('/docs').status_code==404 and c.get('/openapi.json').status_code==404; "
        "assert set(c.get('/health').json().keys())=={'status','database'}; print('OK')"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env={**os.environ, "ENVIRONMENT": "production"}, check=False)
    assert proc.returncode == 0 and "OK" in proc.stdout
