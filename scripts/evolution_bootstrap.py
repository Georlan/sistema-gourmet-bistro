#!/usr/bin/env python3
"""Provisiona e diagnostica a instância Evolution do Kôma sem expor segredos."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


class EvolutionError(RuntimeError):
    pass


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise EvolutionError(f"Variável obrigatória ausente: {name}")
    return value


class EvolutionClient:
    def __init__(self) -> None:
        self.base_url = _required_env("EVOLUTION_API_URL").rstrip("/")
        self.api_key = _required_env("EVOLUTION_API_KEY")
        self.instance = _required_env("EVOLUTION_INSTANCE_NAME")

        if not (
            self.base_url.startswith("https://")
            or self.base_url.startswith("http://localhost")
            or self.base_url.startswith("http://127.0.0.1")
        ):
            raise EvolutionError(
                "Use HTTPS em ambiente remoto; HTTP só é permitido em localhost."
            )

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        include_error_body: bool = True,
    ) -> Any:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "apikey": self.api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = ""
            if include_error_body:
                raw = exc.read().decode("utf-8", errors="replace")[:500]
                detail = f" Resposta: {raw}" if raw else ""
            raise EvolutionError(f"Evolution respondeu HTTP {exc.code}.{detail}") from exc
        except urllib.error.URLError as exc:
            raise EvolutionError(
                f"Não foi possível alcançar a Evolution ({type(exc.reason).__name__})."
            ) from exc

    def status(self) -> str | None:
        data = self.request(
            "GET", f"/instance/connectionState/{self.instance}"
        )
        if not isinstance(data, dict):
            return None
        instance = data.get("instance")
        return instance.get("state") if isinstance(instance, dict) else None

    def provision(self) -> None:
        try:
            state = self.status()
            print(f"Instância existente. Estado: {state or 'desconhecido'}")
        except EvolutionError as exc:
            if "HTTP 404" not in str(exc):
                raise
            self.request(
                "POST",
                "/instance/create",
                {
                    "instanceName": self.instance,
                    "qrcode": True,
                    "integration": "WHATSAPP-BAILEYS",
                    "rejectCall": True,
                    "groupsIgnore": True,
                    "alwaysOnline": False,
                    "readMessages": False,
                    "readStatus": False,
                    "syncFullHistory": False,
                },
            )
            print(f"Instância criada: {self.instance}")

        connection = self.request("GET", f"/instance/connect/{self.instance}")
        if self._write_qr(connection, Path("evolution-qr.png")):
            print("QR Code salvo em evolution-qr.png")
        else:
            print(f"Estado atual: {self.status() or 'desconhecido'}")

    @staticmethod
    def _write_qr(data: Any, output: Path) -> bool:
        if not isinstance(data, dict):
            return False
        candidates = [data.get("base64")]
        qrcode = data.get("qrcode")
        if isinstance(qrcode, dict):
            candidates.append(qrcode.get("base64"))
        for candidate in candidates:
            if not isinstance(candidate, str) or not candidate:
                continue
            encoded = candidate.split(",", 1)[-1]
            try:
                output.write_bytes(base64.b64decode(encoded, validate=True))
                return True
            except (ValueError, OSError):
                continue
        return False

    def send_test(self, phone: str) -> None:
        number = "".join(char for char in phone if char.isdigit())
        if len(number) not in {12, 13} or not number.startswith("55"):
            raise EvolutionError("Informe o telefone como 55 + DDD + número.")
        self.request(
            "POST",
            f"/message/sendText/{self.instance}",
            {
                "number": number,
                "text": "Teste de integração do Kôma concluído com sucesso.",
            },
            include_error_body=False,
        )
        print("Mensagem de teste aceita pela Evolution.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status", help="Mostra o estado da instância")
    subparsers.add_parser("provision", help="Cria a instância e obtém o QR Code")
    send_parser = subparsers.add_parser(
        "send-test", help="Envia uma mensagem explícita de teste"
    )
    send_parser.add_argument("--phone", required=True)
    args = parser.parse_args()

    try:
        client = EvolutionClient()
        if args.command == "status":
            print(f"Estado: {client.status() or 'desconhecido'}")
        elif args.command == "provision":
            client.provision()
        else:
            client.send_test(args.phone)
        return 0
    except EvolutionError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
