import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.fiscal.reference_watch import (
    FiscalReferenceWatchError,
    OfficialReferenceProbe,
    record_probe,
    record_probe_error,
)
from app.fiscal_reference_models import (
    FiscalOfficialReferenceSnapshot,
    FiscalOfficialReferenceState,
)
from app.main import app
from app.routes import super_admin
from app.security import create_access_token, get_password_hash


def _memory_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    FiscalOfficialReferenceSnapshot.__table__.create(engine)
    FiscalOfficialReferenceState.__table__.create(engine)
    return Session(engine)


def test_first_successful_probe_after_initial_error_establishes_active_baseline_and_detects_future_changes():
    session = _memory_session()

    # 1. Primeira tentativa falha (ex.: timeout de rede no Portal Siscomex)
    record_probe_error(
        session,
        "rfb-ncm-json",
        "https://example.invalid/ncm",
        FiscalReferenceWatchError("timeout inicial"),
    )
    session.commit()

    # 2. Próxima tentativa obtém sucesso e deve estabelecer baseline inicial completa
    first_ok = OfficialReferenceProbe(
        source_key="rfb-ncm-json",
        source_url="https://example.invalid/ncm",
        source_version="v1",
        content_sha256="1" * 64,
        metadata={"entry_count": 1200},
        snapshot_payload=[{"Codigo": "01010101", "Descricao": "v1"}],
    )
    result = record_probe(session, first_ok)
    session.commit()

    assert result.status == "current"
    assert result.changed is False
    assert result.active_snapshot_id is not None
    assert result.active_snapshot_id == result.observed_snapshot_id
    assert result.active_sha256 == "1" * 64
    assert result.active_version == "v1"

    # 3. Alteração posterior na fonte oficial DEVE ser detectada como 'changed' (sem silenciar mudança)
    updated = OfficialReferenceProbe(
        source_key="rfb-ncm-json",
        source_url="https://example.invalid/ncm",
        source_version="v2",
        content_sha256="2" * 64,
        metadata={"entry_count": 1205},
        snapshot_payload=[{"Codigo": "01010101", "Descricao": "v2"}],
    )
    changed_result = record_probe(session, updated)
    session.commit()

    assert changed_result.status == "changed"
    assert changed_result.changed is True
    assert changed_result.active_sha256 == "1" * 64
    assert changed_result.observed_sha256 == "2" * 64
    assert changed_result.active_snapshot_id != changed_result.observed_snapshot_id


def test_superadmin_compliance_health_flags_missing_active_snapshot_as_unhealthy(monkeypatch):
    super_admin.superadmin_login_rate_limiter.history.clear()
    monkeypatch.setenv("SUPERADMIN_USERNAME", "fiscal-sa@example.test")
    monkeypatch.setenv("SUPERADMIN_PASSWORD_HASH", get_password_hash("test-secret-123"))

    token = create_access_token(
        subject="fiscal-sa@example.test",
        restaurante_id=0,
        role="superadmin",
    )
    client = TestClient(app)

    db = SessionLocal()
    try:
        db.query(FiscalOfficialReferenceState).filter(
            FiscalOfficialReferenceState.source_key == "rfb-ncm-json"
        ).delete()
        db.add(
            FiscalOfficialReferenceState(
                source_key="rfb-ncm-json",
                source_url="https://example.invalid/ncm",
                status="current",
                active_snapshot_id=None,
                observed_snapshot_id=None,
                checked_at=datetime.datetime.now(datetime.timezone.utc),
            )
        )
        db.commit()

        res = client.get(
            "/api/super-admin/fiscal/compliance",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["healthy"] is False
        assert body["requiresAttention"] is True
    finally:
        db.query(FiscalOfficialReferenceState).filter(
            FiscalOfficialReferenceState.source_key == "rfb-ncm-json"
        ).delete()
        db.commit()
        db.close()
