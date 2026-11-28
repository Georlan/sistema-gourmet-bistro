"""Optional, stateless engineering MCP at the existing ASGI entry point."""

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from .mcp_auth import READ_SCOPE, OperatorAccess
from .mcp_health import build_in_memory_system_health
from .product_catalog import load_product_catalog

MCP_PATH = "/mcp"
METADATA_PATH = "/.well-known/oauth-protected-resource/mcp"
logger = logging.getLogger("koma.mcp")


def _https_url(key: str, path: str | None = None) -> str:
    value = os.environ[key]
    url = urlsplit(value)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username is not None
        or url.query
        or url.fragment
        or (path is not None and url.path != path)
    ):
        raise ValueError(f"Invalid {key}")
    return value


def _product_server(resource: str):
    from mcp.server.mcpserver import MCPServer
    from mcp.server.transport_security import TransportSecuritySettings
    from mcp.types import ToolAnnotations

    server = MCPServer("KÔMA Engenharia")
    catalog = load_product_catalog()

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def ops_get_product_contract() -> dict[str, Any]:
        """Contrato versionado de planos, capacidades e regras. Estados são declarações do catálogo."""
        logger.info('{"event":"tool_call","tool":"ops_get_product_contract"}')
        return {
            key: catalog[key]
            for key in (
                "version",
                "plans",
                "capabilities",
                "future_modules",
                "navigation_rules",
                "endpoint_rules",
                "commercial_comparison_rules",
                "comparison_matrix",
                "online_order_commission_enabled",
                "annual_discount_rate",
                "founders_program",
                "onboarding",
            )
        }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def ops_get_system_health() -> dict[str, Any]:
        """Saúde em memória por fluxo (pool DB, WebSocket, outbox) sem abrir conexão ao banco."""
        logger.info('{"event":"tool_call","tool":"ops_get_system_health"}')
        return build_in_memory_system_health()

    host = urlsplit(resource).netloc
    return server.streamable_http_app(
        stateless_http=True,
        json_response=True,
        max_request_body_size=16_384,
        transport_security=TransportSecuritySettings(
            allowed_hosts=[host], allowed_origins=[f"https://{host}"]
        ),
    )


class RootASGIDispatcher:
    def __init__(self, app: ASGIApp, *, access: OperatorAccess | None):
        self.app = app
        self.access = access

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path")
        if scope["type"] != "http" or path not in (MCP_PATH, METADATA_PATH):
            await self.app(scope, receive, send)
            return
        access = self.access
        if access is None:
            response = Response(status_code=404)
        elif path == METADATA_PATH:
            if scope["method"] in ("GET", "HEAD"):
                response = JSONResponse(
                    {
                        "resource": access.resource,
                        "authorization_servers": [access.issuer],
                        "scopes_supported": [READ_SCOPE],
                        "bearer_methods_supported": ["header"],
                    }
                )
            else:
                response = Response(status_code=405, headers={"Allow": "GET, HEAD"})
        else:
            credentials = Headers(scope=scope).getlist("authorization")
            scheme, _, token = (
                credentials[0].partition(" ") if len(credentials) == 1 else ("", "", "")
            )
            status = 401
            if (
                scheme.lower() == "bearer"
                and token
                and len(token) <= 8192
                and not any(c.isspace() for c in token)
            ):
                client = scope.get("state", {}).get("mcp_introspection_client")
                status = 503 if client is None else await access.check(token, client)
            logger.info(json.dumps({"event": "mcp_access", "status": status}))
            if status == 200:
                await scope["state"]["mcp_app"](scope, receive, send)
                return
            headers = {"Cache-Control": "no-store"}
            if status in (401, 403):
                metadata = access.resource.removesuffix(MCP_PATH) + METADATA_PATH
                error = "invalid_token" if status == 401 else "insufficient_scope"
                headers["WWW-Authenticate"] = (
                    f'Bearer error="{error}", resource_metadata="{metadata}", scope="{READ_SCOPE}"'
                )
            response = Response(status_code=status, headers=headers)
        await response(scope, receive, send)


def install_engineering_mcp(app: FastAPI):
    access = None
    if os.getenv("KOMA_MCP_ENABLED", "false").strip().lower() == "true":
        access = OperatorAccess(
            issuer=_https_url("KOMA_MCP_ISSUER"),
            resource=_https_url("KOMA_MCP_RESOURCE", MCP_PATH),
            client_id=os.environ["KOMA_MCP_CLIENT_ID"],
            subject=os.environ["KOMA_MCP_OPERATOR_SUB"],
            secret=os.environ["KOMA_MCP_INTROSPECTION_SECRET"],
        )
        if not all(
            (access.client_id.strip(), access.subject.strip(), access.secret.strip())
        ):
            raise ValueError("Empty MCP operator configuration")
        original_lifespan = app.router.lifespan_context

        @asynccontextmanager
        async def lifespan(application):
            mcp_app = _product_server(access.resource)
            async with (
                original_lifespan(application) as state,
                mcp_app.router.lifespan_context(mcp_app),
                httpx.AsyncClient(
                    timeout=2, trust_env=False, follow_redirects=False
                ) as client,
            ):
                yield {
                    **(state or {}),
                    "mcp_introspection_client": client,
                    "mcp_app": mcp_app,
                }

        app.router.lifespan_context = lifespan

    # Registered last so the two dedicated paths are handled before tenant JWT middleware.
    app.add_middleware(RootASGIDispatcher, access=access)
