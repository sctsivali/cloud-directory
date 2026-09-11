"""Bounded collector: redirects revalidated, byte/type/deadline limits, immutable receipts."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Mapping, Protocol
from urllib.parse import urljoin

from workers.canonical import sha256_hex
from workers.collector.policy import DnsResolver, ParsedTarget, PolicyError, authorize_url

FETCH_STATES = (
    "ok",
    "redirect",
    "forbidden",
    "not_found",
    "timeout",
    "blocked",
    "oversized",
    "malformed",
    "unsupported_content_type",
)

ALLOWED_CONTENT_TYPES = frozenset(
    {
        "text/html",
        "text/plain",
        "application/json",
        "application/xhtml+xml",
    }
)

REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


class Clock(Protocol):
    def now(self) -> datetime:
        ...


class UtcClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


@dataclass(frozen=True)
class FetchLimits:
    max_bytes: int = 1_048_576
    deadline_seconds: float = 10.0
    max_redirects: int = 3
    allowed_content_types: frozenset[str] = ALLOWED_CONTENT_TYPES


@dataclass(frozen=True)
class HttpResponse:
    """Configured mock origin body. Transport.get must bound this before returning."""

    status_code: int
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True)
class BoundedHttpResult:
    status_code: int
    headers: Mapping[str, str]
    body: bytes
    overflowed: bool
    complete: bool
    connected_address: str
    hostname: str


class HttpTransport(Protocol):
    def get(
        self,
        target: ParsedTarget,
        *,
        max_bytes: int,
        timeout_seconds: float,
    ) -> BoundedHttpResult:
        ...


class LiveHttpTransport:
    """Intentionally unavailable. Phase 4 tests and workers must inject a mock."""

    def get(
        self,
        target: ParsedTarget,
        *,
        max_bytes: int,
        timeout_seconds: float,
    ) -> BoundedHttpResult:
        raise RuntimeError("live HTTP transport is disabled")


@dataclass(frozen=True)
class FetchReceipt:
    source_url: str
    final_url: str
    fetched_at: str
    http_status: int | None
    fetch_state: str
    content_type: str | None
    content_sha256: str
    body: str
    byte_length: int
    redirect_chain: tuple[str, ...]
    truncated: bool

    def snapshot_id(self) -> str:
        material = f"{self.source_url}\n{self.fetched_at}\n{self.content_sha256}"
        return "snap-" + sha256_hex(material)


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _media_type(content_type: str | None) -> str | None:
    if not content_type or not content_type.strip():
        return None
    msg = EmailMessage()
    msg["content-type"] = content_type
    media = msg.get_content_type()
    return media.lower() if media else None


def _iso(now: datetime) -> str:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _decode_body(raw: bytes) -> str | None:
    if b"\x00" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _receipt(
    *,
    source_url: str,
    final_url: str,
    fetched_at: str,
    http_status: int | None,
    fetch_state: str,
    content_type: str | None,
    body_bytes: bytes,
    redirect_chain: tuple[str, ...],
    truncated: bool,
) -> FetchReceipt:
    text = _decode_body(body_bytes) if body_bytes else ""
    if text is None:
        text = ""
        if fetch_state in {"ok", "redirect"}:
            fetch_state = "malformed"
    return FetchReceipt(
        source_url=source_url,
        final_url=final_url,
        fetched_at=fetched_at,
        http_status=http_status,
        fetch_state=fetch_state,
        content_type=content_type,
        content_sha256=sha256_hex(body_bytes),
        body=text,
        byte_length=len(body_bytes),
        redirect_chain=redirect_chain,
        truncated=truncated,
    )


def _state_for_status(status: int, redirected: bool) -> str:
    if status == 200:
        return "redirect" if redirected else "ok"
    if status == 403:
        return "forbidden"
    if status == 404:
        return "not_found"
    if status in REDIRECT_STATUSES:
        return "redirect"
    return "malformed"


def retain_bounded(source: bytes, max_bytes: int) -> tuple[bytes, bool, int]:
    """Copy at most max_bytes from source. Returns (retained, overflowed, peak_retained)."""
    retained = bytearray()
    overflowed = False
    peak = 0
    for index, octet in enumerate(source):
        if index >= max_bytes:
            overflowed = True
            break
        retained.append(octet)
        peak = len(retained)
    return bytes(retained), overflowed, peak


class MockDnsResolver:
    def __init__(self, records: Mapping[str, list[str]] | None = None) -> None:
        self.records = {k.lower().rstrip("."): list(v) for k, v in (records or {}).items()}

    def resolve(self, hostname: str) -> list[str]:
        key = hostname.lower().rstrip(".")
        if key not in self.records:
            raise PolicyError(f"dns resolution failed: no record for {hostname}")
        return list(self.records[key])


class MockHttpTransport:
    def __init__(self, routes: Mapping[str, HttpResponse | Exception]) -> None:
        self.routes = dict(routes)
        self.consumed: list[tuple[str, str, str]] = []
        self.max_retained = 0
        self.last_result: BoundedHttpResult | None = None

    def get(
        self,
        target: ParsedTarget,
        *,
        max_bytes: int,
        timeout_seconds: float,
    ) -> BoundedHttpResult:
        void = timeout_seconds
        del void
        if target.connect_address not in target.addresses:
            raise PolicyError("connect_address is not an authorized address")
        connected = str(target.connect_address)
        self.consumed.append((connected, target.hostname, target.normalized))
        if target.normalized not in self.routes:
            raise KeyError(f"no mock response for {target.normalized}")
        value = self.routes[target.normalized]
        if isinstance(value, Exception):
            raise value
        retained, overflowed, peak = retain_bounded(value.body or b"", max_bytes)
        self.max_retained = max(self.max_retained, peak, len(retained))
        result = BoundedHttpResult(
            status_code=value.status_code,
            headers=dict(value.headers),
            body=retained,
            overflowed=overflowed,
            complete=not overflowed,
            connected_address=connected,
            hostname=target.hostname,
        )
        self.last_result = result
        return result


def _oversized_receipt(
    *,
    source_url: str,
    final_url: str,
    fetched_at: str,
    http_status: int | None,
    content_type: str | None,
    body_bytes: bytes,
    redirect_chain: tuple[str, ...],
    max_bytes: int,
) -> FetchReceipt:
    if len(body_bytes) > max_bytes:
        body_bytes = b""
    return _receipt(
        source_url=source_url,
        final_url=final_url,
        fetched_at=fetched_at,
        http_status=http_status,
        fetch_state="oversized",
        content_type=content_type,
        body_bytes=body_bytes,
        redirect_chain=redirect_chain,
        truncated=True,
    )


def fetch_url(
    url: str,
    *,
    resolver: DnsResolver,
    transport: HttpTransport,
    clock: Clock | None = None,
    limits: FetchLimits | None = None,
) -> FetchReceipt:
    limits = limits or FetchLimits()
    clock = clock or UtcClock()
    started = clock.now()
    fetched_at = _iso(started)
    deadline = started + timedelta(seconds=limits.deadline_seconds)
    chain: list[str] = []
    current_url = url
    current: ParsedTarget | None = None

    try:
        current = authorize_url(current_url, resolver)
    except PolicyError:
        return _receipt(
            source_url=url.strip() if isinstance(url, str) else "",
            final_url=url.strip() if isinstance(url, str) else "",
            fetched_at=fetched_at,
            http_status=None,
            fetch_state="blocked",
            content_type=None,
            body_bytes=b"",
            redirect_chain=(),
            truncated=False,
        )

    source_url = current.normalized
    hops = 0
    while True:
        remaining = (deadline - clock.now()).total_seconds()
        if remaining <= 0:
            return _receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=None,
                fetch_state="timeout",
                content_type=None,
                body_bytes=b"",
                redirect_chain=tuple(chain),
                truncated=False,
            )
        try:
            response = transport.get(
                current,
                max_bytes=limits.max_bytes,
                timeout_seconds=remaining,
            )
        except TimeoutError:
            return _receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=None,
                fetch_state="timeout",
                content_type=None,
                body_bytes=b"",
                redirect_chain=tuple(chain),
                truncated=False,
            )
        except Exception:
            return _receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=None,
                fetch_state="malformed",
                content_type=None,
                body_bytes=b"",
                redirect_chain=tuple(chain),
                truncated=False,
            )

        if clock.now() > deadline:
            return _receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=None,
                fetch_state="timeout",
                content_type=None,
                body_bytes=b"",
                redirect_chain=tuple(chain),
                truncated=False,
            )

        body = response.body or b""
        if response.overflowed or not response.complete or len(body) > limits.max_bytes:
            return _oversized_receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=response.status_code,
                content_type=_header(response.headers, "Content-Type"),
                body_bytes=body,
                redirect_chain=tuple(chain),
                max_bytes=limits.max_bytes,
            )

        if response.status_code in REDIRECT_STATUSES:
            location = _header(response.headers, "Location")
            if not location or not location.strip():
                return _receipt(
                    source_url=source_url,
                    final_url=current.normalized,
                    fetched_at=fetched_at,
                    http_status=response.status_code,
                    fetch_state="malformed",
                    content_type=_header(response.headers, "Content-Type"),
                    body_bytes=body,
                    redirect_chain=tuple(chain),
                    truncated=False,
                )
            hops += 1
            if hops > limits.max_redirects:
                return _receipt(
                    source_url=source_url,
                    final_url=current.normalized,
                    fetched_at=fetched_at,
                    http_status=response.status_code,
                    fetch_state="malformed",
                    content_type=_header(response.headers, "Content-Type"),
                    body_bytes=b"",
                    redirect_chain=tuple(chain),
                    truncated=False,
                )
            nxt = urljoin(current.normalized, location.strip())
            chain.append(current.normalized)
            try:
                current = authorize_url(nxt, resolver)
            except PolicyError:
                return _receipt(
                    source_url=source_url,
                    final_url=nxt,
                    fetched_at=fetched_at,
                    http_status=None,
                    fetch_state="blocked",
                    content_type=None,
                    body_bytes=b"",
                    redirect_chain=tuple(chain),
                    truncated=False,
                )
            continue

        content_type = _header(response.headers, "Content-Type")
        media = _media_type(content_type)
        if response.status_code == 200 and media not in limits.allowed_content_types:
            return _receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=response.status_code,
                fetch_state="unsupported_content_type",
                content_type=content_type,
                body_bytes=body,
                redirect_chain=tuple(chain),
                truncated=False,
            )

        text = _decode_body(body)
        if text is None:
            return _receipt(
                source_url=source_url,
                final_url=current.normalized,
                fetched_at=fetched_at,
                http_status=response.status_code,
                fetch_state="malformed",
                content_type=content_type,
                body_bytes=body,
                redirect_chain=tuple(chain),
                truncated=False,
            )

        state = _state_for_status(response.status_code, redirected=bool(chain))
        return _receipt(
            source_url=source_url,
            final_url=current.normalized,
            fetched_at=fetched_at,
            http_status=response.status_code,
            fetch_state=state,
            content_type=content_type,
            body_bytes=body,
            redirect_chain=tuple(chain),
            truncated=False,
        )
