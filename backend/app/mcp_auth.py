"""Validate opaque operator tokens against the configured issuer on every request."""

import time
from dataclasses import dataclass, field

import httpx

READ_SCOPE = "mcp:ops:read"


@dataclass(frozen=True)
class OperatorAccess:
    issuer: str
    resource: str
    client_id: str
    subject: str
    secret: str = field(repr=False)

    async def check(self, token: str, client: httpx.AsyncClient) -> int:
        try:
            response = await client.post(
                self.issuer.rstrip("/") + "/introspect",
                headers={"Authorization": f"Bearer {self.secret}"},
                data={"token": token},
            )
            if response.status_code != 200:
                return 503
            claims = response.json()
        except (httpx.HTTPError, ValueError):
            return 503
        if not isinstance(claims, dict):
            return 503
        if claims.get("active") is not True:
            return 401
        if (
            claims.get("iss") != self.issuer
            or claims.get("aud") != self.resource
            or claims.get("client_id") != self.client_id
            or claims.get("sub") != self.subject
            or type(claims.get("exp")) is not int
            or claims["exp"] <= time.time()
        ):
            return 401
        scopes = claims.get("scope")
        return (
            200 if isinstance(scopes, str) and READ_SCOPE in scopes.split(" ") else 403
        )
