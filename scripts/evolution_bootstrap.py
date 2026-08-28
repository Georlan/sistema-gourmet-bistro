#!/usr/bin/env python3
"""Provisiona e diagnostica a instância Evolution do Kôma sem expor segredos."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from urllib.parse import quote
from pathlib import Path
from typing import Any


class EvolutionError(RuntimeError):
    pass


def configure_local(template: Path, output: Path, *, force: bool = False) -> None:
    """Cria um .env local com segredos fortes sem imprimi-los no terminal."""
    if output.exists() and not force:
        raise EvolutionError(
            f"O arquivo {output} já existe. Use --force somente para rotacionar os segredos."
        )
    try:
        contents = template.read_text(encoding="utf-8")
    except OSError as exc:
        raise EvolutionError(f"Não foi possível ler o modelo {template}.") from exc

    password_placeholder = "SUBSTITUA_POR_UMA_SENHA_ALEATORIA"
    api_key_placeholder = "SUBSTITUA_POR_UMA_CHAVE_ALEATORIA"
    if password_placeholder not in contents or api_key_placeholder not in contents:
        raise EvolutionError("O modelo não contém os placeholders esperados.")

    contents = contents.replace(password_placeholder, secrets.token_urlsafe(32))
    contents = contents.replace(api_key_placeholder, secrets.token_urlsafe(48))
    output.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if not force:
        flags |= os.O_EXCL
    try:
        descriptor = os.open(output, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as env_file:
            env_file.write(contents)
        os.chmod(output, 0o600)
    except OSError as exc:
        raise EvolutionError(f"Não foi possível criar {output}.") from exc

    print(f"Configuração local criada em {output} (permissões 0600).")


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
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", self.instance):
            raise EvolutionError(
                "EVOLUTION_INSTANCE_NAME aceita somente letras, números, ponto, hífen e sublinhado."
            )
        try:
            configured_timeout = float(
                os.getenv("EVOLUTION_REQUEST_TIMEOUT_SECONDS", "10")
            )
        except ValueError as exc:
            raise EvolutionError(
                "EVOLUTION_REQUEST_TIMEOUT_SECONDS deve ser numérico."
            ) from exc
        self.timeout = max(1.0, min(configured_timeout, 30.0))

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
                **(
                    {"Origin": os.environ["EVOLUTION_API_ORIGIN"].strip()}
                    if os.getenv("EVOLUTION_API_ORIGIN", "").strip()
                    else {}
                ),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
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
            "GET", f"/instance/connectionState/{quote(self.instance, safe='')}"
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

        connection = self.request(
            "GET",
            f"/instance/connect/{quote(self.instance, safe='')}",
        )
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
                os.chmod(output, 0o600)
                return True
            except (ValueError, OSError):
                continue
        return False

    def send_test(self, phone: str) -> None:
        number = "".join(char for char in phone if char.isdigit())
        if len(number) not in {12, 13} or not number.startswith("55"):
            raise EvolutionError("Informe o telefone como 55 + DDD + número.")
        state = self.status()
        if state != "open":
            raise EvolutionError(
                f"A instância não está conectada (estado: {state or 'desconhecido'})."
            )
        response = self.request(
            "POST",
            f"/message/sendText/{quote(self.instance, safe='')}",
            {
                "number": number,
                "text": "Teste de integração do Kôma concluído com sucesso.",
            },
            include_error_body=False,
        )
        key = response.get("key") if isinstance(response, dict) else None
        message_id = key.get("id") if isinstance(key, dict) else None
        if isinstance(message_id, str) and message_id:
            print(f"Mensagem de teste aceita pela Evolution. ID: {message_id[:255]}")
        else:
            print("Mensagem de teste aceita pela Evolution.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    configure_parser = subparsers.add_parser(
        "configure-local", help="Gera o .env local com segredos fortes"
    )
    configure_parser.add_argument(
        "--template", type=Path, default=Path("infra/evolution/.env.example")
    )
    configure_parser.add_argument(
        "--output", type=Path, default=Path("infra/evolution/.env")
    )
    configure_parser.add_argument("--force", action="store_true")
    subparsers.add_parser("status", help="Mostra o estado da instância")
    subparsers.add_parser("provision", help="Cria a instância e obtém o QR Code")
    send_parser = subparsers.add_parser(
        "send-test", help="Envia uma mensagem explícita de teste"
    )
    send_parser.add_argument("--phone", required=True)
    args = parser.parse_args()

    try:
        if args.command == "configure-local":
            configure_local(args.template, args.output, force=args.force)
            return 0
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
