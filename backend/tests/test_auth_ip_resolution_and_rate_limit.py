"""Regressões de segurança para resolução confiável de IP, rate limiting e anti-enumeração (RT-01, RT-02)."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient
from starlette.requests import Request

from app.database import SessionLocal
from app.main import app
from app.models import Restaurante, Usuario
from app.security import IPRateLimiter, get_password_hash
from app.services.client_ip import resolve_client_ip, resolve_client_ip_with_source
from app.services.staff_login_rate_limit import (
    _UNKNOWN_IDENTITY_BUCKETS,
    _UNKNOWN_IDENTITY_LOCK,
)


def _make_request(*, client_host: str, headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1"))
        for k, v in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/auth/login",
        "headers": raw_headers,
        "client": (client_host, 44321),
    }
    return Request(scope)


def test_resolve_client_ip_ignores_leftmost_spoofing_and_untrusted_cf_header(monkeypatch):
    monkeypatch.setenv("TRUST_CF_CONNECTING_IP", "false")
    req = _make_request(
        client_host="100.64.0.15",  # Railway CGNAT internal hop
        headers={
            "X-Forwarded-For": "1.1.1.1, 203.0.113.50, 100.64.0.10",
            "CF-Connecting-IP": "9.9.9.9",
        },
    )
    ip, source = resolve_client_ip_with_source(req)
    assert ip == "203.0.113.50"
    assert source == "x-forwarded-for"


def test_resolve_client_ip_accepts_cf_connecting_ip_only_from_cloudflare_hop(monkeypatch):
    monkeypatch.setenv("TRUST_CF_CONNECTING_IP", "true")
    # Hop anterior é Cloudflare (104.16.0.10) -> CF-Connecting-IP confiável
    cf_req = _make_request(
        client_host="100.64.0.15",
        headers={
            "X-Forwarded-For": "198.51.100.25, 104.16.0.10",
            "CF-Connecting-IP": "198.51.100.25",
        },
    )
    assert resolve_client_ip_with_source(cf_req) == ("198.51.100.25", "cf-connecting-ip")

    # Hop anterior NÃO é Cloudflare (203.0.113.50) -> CF-Connecting-IP forjado é ignorado
    spoof_req = _make_request(
        client_host="100.64.0.15",
        headers={
            "X-Forwarded-For": "203.0.113.50",
            "CF-Connecting-IP": "9.9.9.9",
        },
    )
    assert resolve_client_ip_with_source(spoof_req) == ("203.0.113.50", "x-forwarded-for")


def test_resolve_client_ip_ignores_forwarded_headers_from_untrusted_direct_peer():
    req = _make_request(
        client_host="198.51.100.77",
        headers={"X-Forwarded-For": "8.8.8.8", "CF-Connecting-IP": "4.4.4.4"},
    )
    assert resolve_client_ip_with_source(req) == ("198.51.100.77", "direct")


def test_ip_rate_limiter_isolates_clients_behind_proxy_and_blocks_left_spoofing():
    limiter = IPRateLimiter(requests_per_minute=2)

    # Cliente A por trás do mesmo proxy Railway
    for i in range(2):
        req_a = _make_request(
            client_host="100.64.0.2",
            headers={"X-Forwarded-For": f"10.99.0.{i}, 198.51.100.1"},
        )
        limiter.check(req_a)

    # 3a tentativa do Cliente A mesmo rotacionando prefixo à esquerda -> bloqueado (429)
    req_a_spoof = _make_request(
        client_host="100.64.0.2",
        headers={"X-Forwarded-For": "192.0.2.200, 198.51.100.1"},
    )
    try:
        limiter.check(req_a_spoof)
        assert False, "Expected 429 for spoofed XFF prefix"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 429

    # Cliente B atrás do mesmo proxy não é bloqueado
    req_b = _make_request(
        client_host="100.64.0.2",
        headers={"X-Forwarded-For": "198.51.100.2"},
    )
    limiter.check(req_b)


def test_staff_login_blocks_existing_and_nonexistent_accounts_uniformly_and_preserves_nat_peers():
    with _UNKNOWN_IDENTITY_LOCK:
        _UNKNOWN_IDENTITY_BUCKETS.clear()

    db = SessionLocal()
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if rest is None:
            rest = Restaurante(id=1, nome="Restaurante RT", slug="rest-rt", plano="premium", saas_status="active")
            db.add(rest)
            db.flush()
        for uid, email, pwd in [
            ("rt-staff-1", "rt-exists@koma.invalid", "CorrectPass!1"),
            ("rt-staff-2", "rt-nat-peer@koma.invalid", "PeerPass!1"),
        ]:
            if db.query(Usuario).filter(Usuario.id == uid).first() is None:
                db.add(
                    Usuario(
                        id=uid,
                        restaurante_id=1,
                        nome=uid,
                        email=email,
                        cargo="admin",
                        role="admin",
                        status="ativo",
                        senha_hash=get_password_hash(pwd),
                    )
                )
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        existing_codes = []
        missing_codes = []
        for i in range(10):
            r1 = client.post(
                "/auth/login",
                json={"username": "rt-exists@koma.invalid", "password": f"Wrong!{i}"},
                headers={"X-Forwarded-For": "203.0.113.80"},
            )
            existing_codes.append(r1.status_code)

            r2 = client.post(
                "/auth/login",
                json={"username": "rt-does-not-exist@koma.invalid", "password": f"Wrong!{i}"},
                headers={"X-Forwarded-For": "203.0.113.81"},
            )
            missing_codes.append(r2.status_code)

        # Ambos devem atingir 429 exatamente no mesmo limiar (8 tentativas)
        assert existing_codes == missing_codes
        assert 429 in existing_codes

        # Outro usuário legítimo atrás do mesmo IP NAT (203.0.113.80) consegue logar
        r_peer = client.post(
            "/auth/login",
            json={"username": "rt-nat-peer@koma.invalid", "password": "PeerPass!1"},
            headers={"X-Forwarded-For": "203.0.113.80"},
        )
        assert r_peer.status_code == 200
        assert "access_token" in r_peer.json()


def test_public_recognition_cannot_bypass_rate_limit_by_rotating_left_xff():
    with TestClient(app) as client:
        hit_429 = False
        for i in range(65):
            r = client.post(
                "/cardapio/clientes/reconhecer",
                json={"restaurante_id": 1, "telefone": "85999990001"},
                headers={"X-Forwarded-For": f"192.0.2.{i % 250 + 1}, 203.0.113.90"},
            )
            if r.status_code == 429:
                hit_429 = True
                break
        assert hit_429, "Rotating leftmost XFF must not bypass IP rate limit"
