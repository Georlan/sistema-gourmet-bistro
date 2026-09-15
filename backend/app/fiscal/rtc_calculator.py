from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


DEFAULT_RTC_BASE_URL = os.getenv(
    "KOMA_RTC_CALCULATOR_BASE_URL",
    "http://127.0.0.1:8080/api/calculadora",
).rstrip("/")


class RtcCalculatorError(RuntimeError):
    pass


@dataclass(frozen=True)
class RtcCalculatorVersion:
    app_version: str
    database_version: str
    database_description: str | None
    database_date: str | None
    environment: str | None


class RtcCalculatorClient:
    """Adapter do KÔMA para a Calculadora oficial RTC executada localmente.

    O componente oficial roda no ambiente do integrador e expõe API REST local.
    O KÔMA não usa o ambiente piloto hospedado como dependência de produção.
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout_seconds: float = 5.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = (base_url or DEFAULT_RTC_BASE_URL).rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._client = client

    def _request(self, method: str, path: str, *, json_body: Any = None) -> Any:
        owns_client = self._client is None
        http = self._client or httpx.Client(timeout=self.timeout_seconds)
        try:
            response = http.request(method, f"{self.base_url}{path}", json=json_body)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RtcCalculatorError(f"Falha na Calculadora RTC local: {exc}") from exc
        finally:
            if owns_client:
                http.close()

    def get_version(self) -> RtcCalculatorVersion:
        payload = self._request("GET", "/dados-abertos/versao")
        if not isinstance(payload, dict):
            raise RtcCalculatorError("Resposta de versão da Calculadora RTC inválida.")
        app_version = str(payload.get("versaoApp") or "").strip()
        database_version = str(payload.get("versaoDb") or "").strip()
        if not app_version or not database_version:
            raise RtcCalculatorError("Calculadora RTC não informou versão do app e banco.")
        return RtcCalculatorVersion(
            app_version=app_version,
            database_version=database_version,
            database_description=(
                str(payload.get("descricaoVersaoDb"))
                if payload.get("descricaoVersaoDb") is not None
                else None
            ),
            database_date=(
                str(payload.get("dataVersaoDb"))
                if payload.get("dataVersaoDb") is not None
                else None
            ),
            environment=(
                str(payload.get("ambiente")) if payload.get("ambiente") is not None else None
            ),
        )

    def calculate_general_regime(self, operation: dict[str, Any]) -> dict[str, Any]:
        payload = self._request("POST", "/regime-geral", json_body=operation)
        if not isinstance(payload, dict):
            raise RtcCalculatorError("Calculadora RTC retornou cálculo em formato inválido.")
        return payload

    def validate_ncm(self, ncm: str, *, effective_date: str) -> dict[str, Any]:
        payload = self._request(
            "GET",
            f"/dados-abertos/ncm?ncm={ncm}&data={effective_date}",
        )
        if not isinstance(payload, dict):
            raise RtcCalculatorError("Consulta NCM RTC retornou formato inválido.")
        return payload
