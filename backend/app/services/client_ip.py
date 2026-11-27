"""Resolução centralizada e confiável do IP do cliente para superfícies públicas.

Topologia KÔMA (``docs/engineering/infra-contract.md``):
- O frontend no Cloudflare Pages chama diretamente a API no Railway.
- No Railway, o edge proxy encaminha a conexão ao Uvicorn (que roda sem
  ``--proxy-headers``) por rede privada/CGNAT e anexa o IP do cliente à direita
  de ``X-Forwarded-For``.
- Confiar no primeiro elemento à esquerda de ``X-Forwarded-For`` permite que
  qualquer atacante contorne rate limits rotacionando um prefixo forjado.
- Confiar em ``CF-Connecting-IP`` sem validar que o hop anterior é Cloudflare
  também permite spoofing quando o serviço Railway é alcançado diretamente.
"""

from __future__ import annotations

import ipaddress
import os
from functools import lru_cache
from typing import Iterable

from fastapi import Request

_DEFAULT_TRUSTED_PROXY_CIDRS = (
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "100.64.0.0/10",  # RFC 6598 CGNAT (Railway Edge / internal routing)
    "::1/128",
    "fc00::/7",
)

# CIDRs públicos oficiais da Cloudflare (IPv4/IPv6) usados apenas quando
# TRUST_CF_CONNECTING_IP=true está habilitado para tráfego proxied.
_DEFAULT_CLOUDFLARE_CIDRS = (
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
)


def _parse_networks(raw: str, defaults: tuple[str, ...]) -> tuple[ipaddress._BaseNetwork, ...]:
    nets: list[ipaddress._BaseNetwork] = []
    items: Iterable[str] = (
        [item.strip() for item in raw.split(",") if item.strip()] if raw.strip() else defaults
    )
    for item in items:
        try:
            nets.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
    return tuple(nets)


@lru_cache(maxsize=4)
def _trusted_proxy_networks(extra_raw: str) -> tuple[ipaddress._BaseNetwork, ...]:
    base = _parse_networks("", _DEFAULT_TRUSTED_PROXY_CIDRS)
    extra = _parse_networks(extra_raw, ()) if extra_raw.strip() else ()
    return base + extra


@lru_cache(maxsize=4)
def _cloudflare_networks(custom_raw: str) -> tuple[ipaddress._BaseNetwork, ...]:
    return _parse_networks(custom_raw, _DEFAULT_CLOUDFLARE_CIDRS)


def _parse_valid_ip(raw: str | None) -> str | None:
    candidate = (raw or "").strip()
    if not candidate:
        return None
    # Remove colchetes IPv6 com porta opcional ex: [2001:db8::1]:1234
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    elif candidate.count(":") == 1 and "." in candidate:
        # IPv4:port
        candidate = candidate.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def _ip_in_networks(ip_str: str, networks: tuple[ipaddress._BaseNetwork, ...]) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return any(addr in net for net in networks)


def _is_trusted_peer(peer_host: str | None, trusted_nets: tuple[ipaddress._BaseNetwork, ...]) -> bool:
    if not peer_host:
        return False
    if peer_host == "testclient":
        return True
    parsed = _parse_valid_ip(peer_host)
    if not parsed:
        return False
    return _ip_in_networks(parsed, trusted_nets)


def resolve_client_ip_with_source(request: Request | None) -> tuple[str, str]:
    """Resolve o IP do cliente caminhando a cadeia de proxy da direita para a esquerda.

    Retorna ``(ip, source)`` onde ``source`` é ``cf-connecting-ip``,
    ``x-forwarded-for`` ou ``direct``.
    """
    if request is None:
        return "unknown", "direct"

    raw_peer = request.client.host if getattr(request, "client", None) else None
    peer_ip = _parse_valid_ip(raw_peer) or (str(raw_peer).strip() if raw_peer else "unknown")

    trusted_nets = _trusted_proxy_networks(os.getenv("TRUSTED_PROXY_CIDRS", ""))
    if not _is_trusted_peer(raw_peer, trusted_nets):
        return peer_ip[:128], "direct"

    xff_raw = request.headers.get("x-forwarded-for") or ""
    xff_ips: list[str] = []
    for part in xff_raw.split(","):
        parsed = _parse_valid_ip(part)
        if parsed:
            xff_ips.append(parsed)

    # Caminha da direita para a esquerda ignorando hops de proxies confiáveis.
    resolved_xff: str | None = None
    for candidate in reversed(xff_ips):
        if _ip_in_networks(candidate, trusted_nets):
            continue
        resolved_xff = candidate
        break
    if resolved_xff is None and xff_ips:
        resolved_xff = xff_ips[0]

    # CF-Connecting-IP só é aceito quando explicitamente habilitado E o hop
    # imediatamente confiável pertence aos CIDRs oficiais da Cloudflare.
    trust_cf = os.getenv("TRUST_CF_CONNECTING_IP", "false").strip().lower() == "true"
    if trust_cf:
        cf_nets = _cloudflare_networks(os.getenv("TRUSTED_CLOUDFLARE_CIDRS", ""))
        cf_ip = _parse_valid_ip(request.headers.get("cf-connecting-ip"))
        hop_before_edge = resolved_xff or peer_ip
        if cf_ip and _ip_in_networks(hop_before_edge, cf_nets):
            return cf_ip[:128], "cf-connecting-ip"

    if resolved_xff:
        return resolved_xff[:128], "x-forwarded-for"

    return peer_ip[:128], "direct"


def resolve_client_ip(request: Request | None) -> str:
    """Retorna apenas o IP confiável do cliente."""
    ip, _source = resolve_client_ip_with_source(request)
    return ip
