"""Deterministic provider-fact extractor. Page text is untrusted data."""
from __future__ import annotations

import re
from typing import Any, Mapping

from workers.collector.fetch import FetchReceipt
from workers.extractor.contract import (
    ExtractorError,
    ExtractorSpec,
    ExtractionResult,
    ModelAdapter,
    assert_exact_object,
    run_extractor,
    strip_injection_lines,
    visible_text,
)

SPEC = ExtractorSpec(
    adapter_name="provider",
    ruleset_version="extractor.provider.v1",
    task="extract_provider_facts",
    output_schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["provider_name", "legal_name", "hq_country"],
        "properties": {
            "provider_name": {"type": ["string", "null"]},
            "legal_name": {"type": ["string", "null"]},
            "hq_country": {"type": ["string", "null"]},
        },
    },
    required_keys=("provider_name", "legal_name", "hq_country"),
)


def parse_provider_output(raw: Any) -> dict[str, Any]:
    obj = assert_exact_object(raw, SPEC.required_keys)
    for key in SPEC.required_keys:
        val = obj[key]
        if val is not None and not isinstance(val, str):
            raise ExtractorError(f"{key} must be a string or null")
        if isinstance(val, str) and not val.strip():
            raise ExtractorError(f"{key} must not be empty")
    return obj


class DeterministicProviderAdapter:
    model_provider = "rules"
    model_name = "extractor.provider.v1"

    def complete(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        text = strip_injection_lines(str(envelope.get("untrusted_source_text") or ""))
        name = None
        legal = None
        country = None
        m = re.search(r"(?m)^([A-Za-z][^\n]{1,80})$", text)
        if m:
            name = m.group(1).strip()
        m = re.search(r"Legal entity:\s*([^.\n]+)", text, re.I)
        if m:
            legal = m.group(1).strip()
        m = re.search(
            r"\b(Indonesia|Malaysia|Singapore|Thailand|Vietnam|Philippines|Cambodia|Laos|Myanmar|Brunei)\b",
            text,
            re.I,
        )
        if m:
            country = m.group(1)
        return {
            "provider_name": name,
            "legal_name": legal,
            "hq_country": country,
        }


def extract_provider(receipt: FetchReceipt, subject: Mapping[str, Any], adapter: ModelAdapter | None = None) -> ExtractionResult:
    return run_extractor(
        SPEC,
        receipt,
        subject,
        adapter or DeterministicProviderAdapter(),
        parse=parse_provider_output,
    )


def from_visible(html: str) -> dict[str, Any]:
    return DeterministicProviderAdapter().complete({"untrusted_source_text": visible_text(html)})
