"""Bounded collector: SSRF, redirects, 403/404/timeout, oversized and malformed bodies."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path

from workers.collector.fetch import (
    BoundedHttpResult,
    FetchLimits,
    FetchReceipt,
    HttpResponse,
    LiveHttpTransport,
    MockDnsResolver,
    MockHttpTransport,
    fetch_url,
    retain_bounded,
)
from workers.collector.policy import PolicyError, authorize_url, ip_is_blocked, parse_http_url

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "sources"
PUBLIC_IP = "93.184.216.34"
EXAMPLE = "https://fixtures.example.test/page"


class FrozenClock:
    def __init__(self, value: datetime | None = None) -> None:
        self.value = value or datetime(2026, 9, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self.value


def _html(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _dns() -> MockDnsResolver:
    return MockDnsResolver({"fixtures.example.test": [PUBLIC_IP], "safe.example.test": [PUBLIC_IP]})


class TestUrlPolicy(unittest.TestCase):
    def test_only_http_https_are_parsed(self):
        parse_http_url("https://fixtures.example.test/a")
        parse_http_url("http://fixtures.example.test/a")
        for raw in (
            "file:///etc/passwd",
            "ftp://fixtures.example.test/a",
            "gopher://fixtures.example.test/a",
            "javascript:alert(1)",
            "",
        ):
            with self.subTest(raw=raw):
                with self.assertRaises(PolicyError):
                    parse_http_url(raw)

    def test_credentials_and_non_web_ports_fail_closed(self):
        with self.assertRaises(PolicyError):
            parse_http_url("https://user:pass@fixtures.example.test/a")
        with self.assertRaises(PolicyError):
            parse_http_url("https://fixtures.example.test:22/a")

    def test_literal_blocked_addresses(self):
        resolver = _dns()
        blocked = (
            "http://127.0.0.1/",
            "http://localhost/",
            "http://192.168.1.8/ssrf",
            "http://10.0.0.4/",
            "http://172.16.0.4/",
            "http://169.254.169.254/latest",
            "http://0.0.0.0/",
            "http://[::1]/",
            "http://[fe80::1]/",
            "http://[ff02::1]/",
        )
        for raw in blocked:
            with self.subTest(raw=raw):
                with self.assertRaises(PolicyError):
                    authorize_url(raw, resolver)

    def test_dns_to_loopback_is_blocked(self):
        resolver = MockDnsResolver({"evil.example.test": ["127.0.0.1"]})
        with self.assertRaises(PolicyError):
            authorize_url("https://evil.example.test/page", resolver)

    def test_ipv4_mapped_loopback_is_blocked(self):
        resolver = MockDnsResolver({"mapped.example.test": ["::ffff:127.0.0.1"]})
        with self.assertRaises(PolicyError):
            authorize_url("https://mapped.example.test/page", resolver)

    def test_non_global_ranges_fail_closed(self):
        import ipaddress

        blocked = (
            "100.64.0.1",
            "100.127.255.254",
            "198.18.0.1",
            "198.19.255.1",
            "240.0.0.1",
            "255.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "0.0.0.0",
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "192.168.1.8",
            "224.0.0.1",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456:789a::1",
            "2001:db8::1",
            "2001:2::1",
            "::ffff:100.64.0.1",
            "::ffff:198.18.0.1",
            "::ffff:240.0.0.1",
            "::ffff:127.0.0.1",
        )
        for raw in blocked:
            addr = ipaddress.ip_address(raw)
            with self.subTest(raw=raw):
                if addr.version == 6 and addr.ipv4_mapped is not None:
                    self.assertFalse(addr.ipv4_mapped.is_global)
                elif not addr.is_multicast:
                    self.assertFalse(addr.is_global)
                self.assertTrue(ip_is_blocked(addr))

        public = (PUBLIC_IP, "8.8.8.8", "2001:4860:4860::8888", "::ffff:93.184.216.34")
        for raw in public:
            with self.subTest(public=raw):
                self.assertFalse(ip_is_blocked(ipaddress.ip_address(raw)))

        resolver = MockDnsResolver({})
        literals = (
            "http://100.64.0.1/",
            "http://198.18.1.1/",
            "http://240.1.2.3/",
            "http://[fc00::1]/",
            "http://[2001:db8::1]/",
            "http://[::ffff:100.64.0.1]/",
        )
        for raw in literals:
            with self.subTest(literal=raw):
                with self.assertRaises(PolicyError):
                    authorize_url(raw, resolver)

        names = {
            "cgnat.example.test": ["100.64.1.2"],
            "bench.example.test": ["198.18.0.9"],
            "reserved.example.test": ["240.0.0.8"],
            "ula.example.test": ["fd00::1"],
            "mapped-cgnat.example.test": ["::ffff:100.64.0.5"],
        }
        for host, addrs in names.items():
            with self.subTest(host=host):
                with self.assertRaises(PolicyError):
                    authorize_url(f"https://{host}/page", MockDnsResolver({host: addrs}))


class TestFetchStates(unittest.TestCase):
    def test_direct_200_is_distinct_from_redirect(self):
        body = _html("ok-200.html")
        transport = MockHttpTransport(
            {
                EXAMPLE: HttpResponse(200, {"Content-Type": "text/html; charset=utf-8"}, body),
            }
        )
        receipt = fetch_url(EXAMPLE, resolver=_dns(), transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "ok")
        self.assertEqual(receipt.http_status, 200)
        self.assertEqual(receipt.redirect_chain, ())
        self.assertIn("Nusantara Compute", receipt.body)
        self.assertEqual(len(receipt.content_sha256), 64)
        self.assertTrue(receipt.snapshot_id().startswith("snap-"))

    def test_redirect_is_revalidated_and_distinct(self):
        start = "https://fixtures.example.test/old"
        final = "https://fixtures.example.test/new"
        transport = MockHttpTransport(
            {
                start: HttpResponse(302, {"Location": final, "Content-Type": "text/html"}, _html("redirect-302.html")),
                final: HttpResponse(200, {"Content-Type": "text/html"}, _html("ok-200.html")),
            }
        )
        receipt = fetch_url(start, resolver=_dns(), transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "redirect")
        self.assertEqual(receipt.http_status, 200)
        self.assertEqual(receipt.source_url, start)
        self.assertEqual(receipt.final_url, final)
        self.assertEqual(receipt.redirect_chain, (start,))

    def test_redirect_to_loopback_is_blocked(self):
        start = "https://fixtures.example.test/old"
        transport = MockHttpTransport(
            {
                start: HttpResponse(
                    302,
                    {"Location": "http://127.0.0.1/secret", "Content-Type": "text/html"},
                    _html("redirect-302.html"),
                ),
            }
        )
        receipt = fetch_url(start, resolver=_dns(), transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "blocked")
        self.assertIsNone(receipt.http_status)
        self.assertEqual(receipt.redirect_chain, (start,))

    def test_redirect_dns_rebind_is_blocked(self):
        start = "https://fixtures.example.test/old"
        nxt = "https://safe.example.test/inner"
        resolver = MockDnsResolver(
            {"fixtures.example.test": [PUBLIC_IP], "safe.example.test": ["10.1.2.3"]}
        )
        transport = MockHttpTransport(
            {start: HttpResponse(302, {"Location": nxt}, b"moved")}
        )
        receipt = fetch_url(start, resolver=resolver, transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "blocked")

    def test_403_and_404_remain_distinct(self):
        forbidden = "https://fixtures.example.test/403"
        missing = "https://fixtures.example.test/404"
        transport = MockHttpTransport(
            {
                forbidden: HttpResponse(403, {"Content-Type": "text/html"}, _html("forbidden-403.html")),
                missing: HttpResponse(404, {"Content-Type": "text/html"}, _html("missing-404.html")),
            }
        )
        r403 = fetch_url(forbidden, resolver=_dns(), transport=transport, clock=FrozenClock())
        r404 = fetch_url(missing, resolver=_dns(), transport=transport, clock=FrozenClock())
        self.assertEqual(r403.fetch_state, "forbidden")
        self.assertEqual(r403.http_status, 403)
        self.assertIn("403 Forbidden", r403.body)
        self.assertEqual(r404.fetch_state, "not_found")
        self.assertEqual(r404.http_status, 404)

    def test_timeout_has_no_http_status(self):
        transport = MockHttpTransport({EXAMPLE: TimeoutError("deadline")})
        receipt = fetch_url(EXAMPLE, resolver=_dns(), transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "timeout")
        self.assertIsNone(receipt.http_status)

    def test_oversized_body_fails_closed(self):
        huge = b"<html>" + (b"x" * 2000)
        transport = MockHttpTransport(
            {EXAMPLE: HttpResponse(200, {"Content-Type": "text/html"}, huge)}
        )
        receipt = fetch_url(
            EXAMPLE,
            resolver=_dns(),
            transport=transport,
            clock=FrozenClock(),
            limits=FetchLimits(max_bytes=512),
        )
        self.assertEqual(receipt.fetch_state, "oversized")
        self.assertTrue(receipt.truncated)
        self.assertLessEqual(receipt.byte_length, 512)
        self.assertLessEqual(transport.max_retained, 512)
        self.assertIsNotNone(transport.last_result)
        assert transport.last_result is not None
        self.assertTrue(transport.last_result.overflowed)
        self.assertFalse(transport.last_result.complete)
        self.assertLessEqual(len(transport.last_result.body), 512)

    def test_malformed_nul_body_fails_closed(self):
        transport = MockHttpTransport(
            {EXAMPLE: HttpResponse(200, {"Content-Type": "text/html"}, b"ok\x00bad")}
        )
        receipt = fetch_url(EXAMPLE, resolver=_dns(), transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "malformed")

    def test_receipt_is_immutable(self):
        transport = MockHttpTransport(
            {EXAMPLE: HttpResponse(200, {"Content-Type": "text/html"}, _html("ok-200.html"))}
        )
        receipt = fetch_url(EXAMPLE, resolver=_dns(), transport=transport, clock=FrozenClock())
        with self.assertRaises(Exception):
            receipt.fetch_state = "ok"  # type: ignore[misc]
        self.assertIsInstance(receipt, FetchReceipt)


class TestBlockedIpHelper(unittest.TestCase):
    def test_multicast_and_unspecified(self):
        import ipaddress

        self.assertTrue(ip_is_blocked(ipaddress.ip_address("224.0.0.1")))
        self.assertTrue(ip_is_blocked(ipaddress.ip_address("0.0.0.0")))
        self.assertFalse(ip_is_blocked(ipaddress.ip_address(PUBLIC_IP)))


class TestPinnedBoundedTransport(unittest.TestCase):
    def test_authorized_address_is_the_one_consumed(self):
        class FlipFlopResolver:
            def __init__(self) -> None:
                self.calls = 0

            def resolve(self, hostname: str) -> list[str]:
                self.calls += 1
                if self.calls == 1:
                    return [PUBLIC_IP]
                return ["127.0.0.1"]

        resolver = FlipFlopResolver()
        transport = MockHttpTransport(
            {EXAMPLE: HttpResponse(200, {"Content-Type": "text/html"}, _html("ok-200.html"))}
        )
        receipt = fetch_url(EXAMPLE, resolver=resolver, transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "ok")
        self.assertEqual(resolver.calls, 1)
        self.assertEqual(transport.consumed, [(PUBLIC_IP, "fixtures.example.test", EXAMPLE)])
        self.assertEqual(transport.last_result.connected_address, PUBLIC_IP)
        self.assertEqual(transport.last_result.hostname, "fixtures.example.test")

    def test_redirect_hops_are_separately_rebound_and_revalidated(self):
        start = "https://fixtures.example.test/old"
        nxt = "https://other.example.test/new"
        other_ip = "8.8.8.8"
        resolver = MockDnsResolver(
            {"fixtures.example.test": [PUBLIC_IP], "other.example.test": [other_ip]}
        )
        transport = MockHttpTransport(
            {
                start: HttpResponse(302, {"Location": nxt, "Content-Type": "text/html"}, b"moved"),
                nxt: HttpResponse(200, {"Content-Type": "text/html"}, _html("ok-200.html")),
            }
        )
        receipt = fetch_url(start, resolver=resolver, transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "redirect")
        self.assertEqual(
            transport.consumed,
            [
                (PUBLIC_IP, "fixtures.example.test", start),
                (other_ip, "other.example.test", nxt),
            ],
        )

    def test_redirect_rebind_to_non_global_does_not_consume_second_hop(self):
        start = "https://fixtures.example.test/old"
        nxt = "https://other.example.test/inner"
        resolver = MockDnsResolver(
            {"fixtures.example.test": [PUBLIC_IP], "other.example.test": ["100.64.0.9"]}
        )
        transport = MockHttpTransport({start: HttpResponse(302, {"Location": nxt}, b"moved")})
        receipt = fetch_url(start, resolver=resolver, transport=transport, clock=FrozenClock())
        self.assertEqual(receipt.fetch_state, "blocked")
        self.assertEqual(transport.consumed, [(PUBLIC_IP, "fixtures.example.test", start)])

    def test_max_plus_one_is_rejected_before_retaining_more_than_bound(self):
        max_bytes = 64
        source = b"x" * (max_bytes + 1)
        retained, overflowed, peak = retain_bounded(source, max_bytes)
        self.assertTrue(overflowed)
        self.assertEqual(len(retained), max_bytes)
        self.assertEqual(peak, max_bytes)
        self.assertLessEqual(peak, max_bytes)

        transport = MockHttpTransport(
            {EXAMPLE: HttpResponse(200, {"Content-Type": "text/html"}, source)}
        )
        receipt = fetch_url(
            EXAMPLE,
            resolver=_dns(),
            transport=transport,
            clock=FrozenClock(),
            limits=FetchLimits(max_bytes=max_bytes),
        )
        self.assertEqual(receipt.fetch_state, "oversized")
        self.assertTrue(receipt.truncated)
        self.assertLessEqual(receipt.byte_length, max_bytes)
        self.assertLessEqual(transport.max_retained, max_bytes)
        self.assertIsNotNone(transport.last_result)
        assert transport.last_result is not None
        self.assertTrue(transport.last_result.overflowed)
        self.assertFalse(transport.last_result.complete)
        self.assertEqual(len(transport.last_result.body), max_bytes)
        self.assertEqual(transport.consumed[0][0], PUBLIC_IP)

    def test_rogue_oversize_body_is_discarded(self):
        max_bytes = 32

        class RogueTransport:
            def get(self, target, *, max_bytes: int, timeout_seconds: float) -> BoundedHttpResult:
                return BoundedHttpResult(
                    status_code=200,
                    headers={"Content-Type": "text/html"},
                    body=b"x" * (max_bytes + 1),
                    overflowed=True,
                    complete=False,
                    connected_address=str(target.connect_address),
                    hostname=target.hostname,
                )

        receipt = fetch_url(
            EXAMPLE,
            resolver=_dns(),
            transport=RogueTransport(),
            clock=FrozenClock(),
            limits=FetchLimits(max_bytes=max_bytes),
        )
        self.assertEqual(receipt.fetch_state, "oversized")
        self.assertLessEqual(receipt.byte_length, max_bytes)
        self.assertEqual(receipt.byte_length, 0)

    def test_live_http_transport_remains_disabled(self):
        target = authorize_url(EXAMPLE, _dns())
        with self.assertRaises(RuntimeError):
            LiveHttpTransport().get(target, max_bytes=16, timeout_seconds=1.0)
