import json
import logging

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.routes.validation_observability import ValidationObservabilityRoute


class _Payload(BaseModel):
    cliente_telefone: str = Field(min_length=10)
    quantidade: int = Field(ge=1)


def test_validation_observability_logs_only_location_and_type(caplog):
    router = APIRouter(route_class=ValidationObservabilityRoute)

    @router.post("/cardapio/pedidos")
    def _create(payload: _Payload):
        return payload

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    secret_phone = "123"
    caplog.set_level(logging.WARNING, logger="koma.validation")
    response = client.post(
        "/cardapio/pedidos",
        json={"cliente_telefone": secret_phone, "quantidade": 0},
    )

    assert response.status_code == 422
    records = [record for record in caplog.records if record.name == "koma.validation"]
    assert len(records) == 1

    event = json.loads(records[0].getMessage())
    assert event["event"] == "request_validation_failed"
    assert event["path"] == "/cardapio/pedidos"
    assert event["method"] == "POST"
    assert all(set(issue) == {"loc", "type"} for issue in event["issues"])
    assert any(issue["loc"] == ["body", "cliente_telefone"] for issue in event["issues"])
    assert any(issue["loc"] == ["body", "quantidade"] for issue in event["issues"])

    serialized = records[0].getMessage()
    assert secret_phone not in serialized
    assert "input" not in serialized
