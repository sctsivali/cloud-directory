"""Deterministic offering extractor. Exact JSON only."""
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
)

SPEC = ExtractorSpec(
    adapter_name="offering",
    ruleset_version="extractor.offering.v1",
    task="extract_offerings",
    output_schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["offerings"],
        "properties": {
            "offerings": {"type": "array"},
        },
    },
    required_keys=("offerings",),
)

OFFERING_KEYS = ("name", "amount", "currency", "billing_unit", "promo", "commitment")


def parse_offering_output(raw: Any) -> dict[str, Any]:
    obj = assert_exact_object(raw, SPEC.required_keys)
    rows = obj["offerings"]
    if not isinstance(rows, list):
        raise ExtractorError("offerings must be an array")
    parsed: list[dict[str, Any]] = []
    for row in rows:
        item = assert_exact_object(row, OFFERING_KEYS)
        if not isinstance(item["name"], str) or not item["name"].strip():
            raise ExtractorError("offering name is required")
        if not isinstance(item["amount"], str) or not item["amount"].strip():
            raise ExtractorError("offering amount must be a decimal string")
        if not isinstance(item["currency"], str) or not item["currency"].strip():
            raise ExtractorError("offering currency is required")
        if not isinstance(item["billing_unit"], str) or not item["billing_unit"].strip():
            raise ExtractorError("offering billing_unit is required")
        if not isinstance(item["promo"], bool):
            raise ExtractorError("promo must be a boolean")
        if not isinstance(item["commitment"], str) or not item["commitment"].strip():
            raise ExtractorError("commitment is required")
        parsed.append(item)
    return {"offerings": parsed}


class DeterministicOfferingAdapter:
    model_provider = "rules"
    model_name = "extractor.offering.v1"

    def complete(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        text = strip_injection_lines(str(envelope.get("untrusted_source_text") or ""))
        offerings: list[dict[str, Any]] = []
        for m in re.finditer(
            r"([A-Za-z][\w \-]{0,40}?)\s+"
            r"(USD|IDR|VND|THB|SGD|MYR|PHP|BND|KHR|LAK|MMK)\s*"
            r"([\d]+(?:[.,]\d+)?)\s*/\s*(month|year|hour)",
            text,
            re.I,
        ):
            name = m.group(1).strip()
            currency = m.group(2).upper()
            amount = m.group(3).replace(",", "")
            unit = m.group(4).lower()
            window = text[max(0, m.start() - 40) : m.end() + 40].lower()
            promo = "promo" in window
            commitment = "year" if unit == "year" or "annual" in window or "12 month" in window else "none"
            offerings.append(
                {
                    "name": name,
                    "amount": amount,
                    "currency": currency,
                    "billing_unit": unit,
                    "promo": promo,
                    "commitment": commitment,
                }
            )
        return {"offerings": offerings}


def extract_offering(receipt: FetchReceipt, subject: Mapping[str, Any], adapter: ModelAdapter | None = None) -> ExtractionResult:
    return run_extractor(
        SPEC,
        receipt,
        subject,
        adapter or DeterministicOfferingAdapter(),
        parse=parse_offering_output,
    )
