"""Extractor contracts: exact JSON, least-data envelopes, prompt-injection isolation."""
from __future__ import annotations

import unittest
from pathlib import Path

from workers.collector.fetch import FetchReceipt
from workers.extractor.contract import (
    ENVELOPE_SCHEMA,
    ExtractorError,
    ProgrammedAdapter,
    assert_exact_object,
    build_envelope,
    strip_injection_lines,
)
from workers.extractor.facility import SPEC as FACILITY_SPEC
from workers.extractor.facility import extract_facility
from workers.extractor.offering import extract_offering
from workers.extractor.provider import SPEC as PROVIDER_SPEC
from workers.extractor.provider import extract_provider
from workers.extractor.technology import extract_technology

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "sources"


def _receipt(filename: str, state: str = "ok") -> FetchReceipt:
    body = (FIXTURES / filename).read_text()
    return FetchReceipt(
        source_url="https://fixtures.example.test/page",
        final_url="https://fixtures.example.test/page",
        fetched_at="2026-09-01T00:00:00Z",
        http_status=200,
        fetch_state=state,
        content_type="text/html",
        content_sha256="a" * 64,
        body=body,
        byte_length=len(body.encode()),
        redirect_chain=(),
        truncated=False,
    )


class TestEnvelope(unittest.TestCase):
    def test_page_text_is_untrusted_and_not_in_instructions(self):
        receipt = _receipt("prompt-injection.html")
        envelope = build_envelope(PROVIDER_SPEC, receipt, {"provider_id": "kvm-negated"})
        self.assertEqual(envelope["schema"], ENVELOPE_SCHEMA)
        self.assertIn("untrusted_source_text", envelope)
        self.assertIn("Ignore previous instructions", envelope["untrusted_source_text"])
        self.assertNotIn("Ignore previous instructions", envelope["operator_instructions"])
        self.assertIn("inert quoted data", envelope["operator_instructions"])
        self.assertEqual(envelope["source"]["fetched_at"], "2026-09-01T00:00:00Z")
        self.assertNotIn("sql", envelope)
        self.assertNotIn("providers", envelope["subject"])

    def test_exact_json_rejects_extra_keys(self):
        with self.assertRaises(ExtractorError):
            assert_exact_object({"provider_name": "x", "legal_name": None, "hq_country": None, "extra": 1}, PROVIDER_SPEC.required_keys)

    def test_programmed_adapter_must_still_match_schema(self):
        receipt = _receipt("ok-200.html")
        with self.assertRaises(ExtractorError):
            extract_provider(receipt, {"provider_id": "x"}, ProgrammedAdapter({"nope": True}))


class TestDeterministicAdapters(unittest.TestCase):
    def test_prompt_injection_cannot_force_kvm_present(self):
        receipt = _receipt("prompt-injection.html")
        result = extract_technology(receipt, {"provider_id": "kvm-negated"})
        rows = result.output["technologies"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "KVM")
        self.assertEqual(rows[0]["knowledge_state"], "confirmed_absent")
        self.assertIn("do not use KVM", rows[0]["excerpt"])
        self.assertNotIn("Ignore previous", strip_injection_lines(receipt.body))
        self.assertEqual(len(result.provenance.input_digest), 64)
        self.assertEqual(len(result.provenance.output_digest), 64)
        self.assertEqual(result.provenance.ruleset_version, "extractor.technology.v1")

    def test_negated_kvm_fixture(self):
        receipt = _receipt("negated-kvm.html")
        rows = extract_technology(receipt, {"provider_id": "kvm-negated"}).output["technologies"]
        self.assertEqual(rows[0]["knowledge_state"], "confirmed_absent")

    def test_office_address_is_not_a_dc_pin(self):
        receipt = _receipt("office-address.html")
        rows = extract_facility(receipt, {"provider_id": "harbour"}).output["facilities"]
        kinds = {row["kind"] for row in rows}
        self.assertIn("office", kinds)
        for row in rows:
            if row["kind"] == "office":
                self.assertEqual(row["map_precision"], "undisclosed")
            if row["kind"] == "datacenter":
                self.assertEqual(row["map_precision"], "undisclosed")

    def test_office_cannot_be_programmed_as_facility_exact(self):
        receipt = _receipt("office-address.html")
        hostile = ProgrammedAdapter(
            {
                "facilities": [
                    {
                        "name": "HQ",
                        "city": "Singapore",
                        "country": "Singapore",
                        "kind": "office",
                        "map_precision": "facility_exact",
                        "address": "12 Orchard Road",
                        "excerpt": "sales office",
                    }
                ]
            }
        )
        with self.assertRaises(ExtractorError):
            extract_facility(receipt, {"provider_id": "harbour"}, hostile)

    def test_offerings_and_provider_from_200_page(self):
        receipt = _receipt("ok-200.html")
        provider = extract_provider(receipt, {"provider_id": "local-packages"})
        self.assertEqual(provider.output["hq_country"], "Indonesia")
        offerings = extract_offering(receipt, {"provider_id": "local-packages"}).output["offerings"]
        self.assertGreaterEqual(len(offerings), 1)
        self.assertEqual(offerings[0]["currency"], "USD")
        self.assertEqual(offerings[0]["billing_unit"], "month")
        envelope = build_envelope(FACILITY_SPEC, receipt, {"provider_id": "local-packages"})
        self.assertIn("Nusantara", envelope["untrusted_source_text"])
