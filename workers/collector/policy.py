"""Strict http(s) URL parsing and DNS/address policy. Fail closed on SSRF."""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = {None, 80, 443}
MAX_URL_LENGTH = 2048

_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "ip6-localhost",
        "ip6-loopback",
    }
)


class PolicyError(ValueError):
    """URL or resolved address is not allowed."""


@dataclass(frozen=True)
class ParsedTarget:
    original: str
    normalized: str
    scheme: str
    hostname: str
    port: int | None
    addresses: tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]
    connect_address: ipaddress.IPv4Address | ipaddress.IPv6Address


class DnsResolver:
    """Resolve a hostname to IP addresses. Tests inject a mock; live DNS is not used."""

    def resolve(self, hostname: str) -> list[str]:
        raise NotImplementedError("DNS resolver must be injected; live lookup is disabled")


def _looks_blocked_hostname(hostname: str) -> bool:
    lowered = hostname.rstrip(".").lower()
    if lowered in _BLOCKED_HOSTNAMES:
        return True
    if lowered.endswith(".localhost"):
        return True
    return False


def _ip_from_literal(hostname: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    raw = hostname.strip()
    if raw.startswith("[") and raw.endswith("]"):
        raw = raw[1:-1]
    try:
        return ipaddress.ip_address(raw)
    except ValueError:
        pass
    try:
        packed = socket.inet_aton(raw)
        return ipaddress.IPv4Address(packed)
    except OSError:
        return None


def ip_is_blocked(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Fail closed for every non-global address, including IPv4-mapped forms."""
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return ip_is_blocked(addr.ipv4_mapped)
    if not addr.is_global:
        return True
    if addr.is_multicast:
        return True
    return False


def _require_public_addresses(addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address]) -> None:
    if not addresses:
        raise PolicyError("hostname did not resolve to any address")
    for addr in addresses:
        if ip_is_blocked(addr):
            raise PolicyError(f"blocked address: {addr}")


def parse_http_url(raw: str) -> urlsplit:
    if not isinstance(raw, str) or not raw.strip():
        raise PolicyError("url is required")
    text = raw.strip()
    if len(text) > MAX_URL_LENGTH:
        raise PolicyError("url exceeds maximum length")
    if any(ch.isspace() for ch in text):
        raise PolicyError("url must not contain whitespace")
    if "\\" in text:
        raise PolicyError("url must not contain backslashes")
    parts = urlsplit(text)
    scheme = (parts.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        raise PolicyError(f"unsupported scheme: {parts.scheme or '(none)'}")
    if parts.username is not None or parts.password is not None:
        raise PolicyError("url must not contain credentials")
    hostname = parts.hostname
    if not hostname:
        raise PolicyError("hostname is required")
    if _looks_blocked_hostname(hostname):
        raise PolicyError(f"blocked hostname: {hostname}")
    if parts.port not in ALLOWED_PORTS:
        raise PolicyError(f"port not allowed: {parts.port}")
    return parts


def authorize_url(raw: str, resolver: DnsResolver) -> ParsedTarget:
    parts = parse_http_url(raw)
    hostname = parts.hostname
    assert hostname is not None
    literal = _ip_from_literal(hostname)
    if literal is not None:
        _require_public_addresses([literal])
        addresses: tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...] = (literal,)
    else:
        try:
            resolved = list(resolver.resolve(hostname.rstrip(".").lower()))
        except PolicyError:
            raise
        except Exception as exc:
            raise PolicyError(f"dns resolution failed: {exc}") from exc
        parsed_addrs: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for item in resolved:
            try:
                parsed_addrs.append(ipaddress.ip_address(item))
            except ValueError as exc:
                raise PolicyError(f"resolver returned a non-IP: {item}") from exc
        _require_public_addresses(parsed_addrs)
        addresses = tuple(parsed_addrs)
    scheme = parts.scheme.lower()
    port = parts.port
    netloc = hostname.lower().rstrip(".")
    if port is not None:
        netloc = f"{netloc}:{port}"
    if ":" in hostname and not hostname.startswith("["):
        host_for_netloc = f"[{hostname}]"
        netloc = host_for_netloc if port is None else f"{host_for_netloc}:{port}"
    normalized = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    return ParsedTarget(
        original=raw.strip(),
        normalized=normalized,
        scheme=scheme,
        hostname=hostname.rstrip(".").lower(),
        port=port,
        addresses=addresses,
        connect_address=addresses[0],
    )
