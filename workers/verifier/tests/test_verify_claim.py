"""Independent verifier: excerpt, scope, negation, hedging, conflict, authority, freshness."""
from __future__ import annotations

import unittest
from pathlib import Path

from workers.verifier.verify_claim import VerificationRequest, verify_claim

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "sources"


def _body(name: str) -> str:
    return (FIXTURES / name).read_text()


class TestVerifyClaim(unittest.TestCase):
    def test_excerpt_must_exist_exactly(self):
        body = _body("negated-kvm.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="We use KVM everywhere",
                snapshot_body=body,
                subject_id="kvm-negated",
                evidence_subject_id="kvm-negated",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="extracted",
                fetched_at="2026-09-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope="provider",
            )
        )
        self.assertFalse(result.accepted)
        self.assertIn("excerpt", result.reasons[0])

    def test_subject_mismatch_fails(self):
        body = _body("ok-200.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="Hypervisor: KVM",
                snapshot_body=body,
                subject_id="provider-a",
                evidence_subject_id="provider-b",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="extracted",
                fetched_at="2026-09-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope="provider",
            )
        )
        self.assertFalse(result.accepted)
        self.assertIn("subject", result.reasons[0])

    def test_negated_kvm_is_not_present(self):
        body = _body("negated-kvm.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="We do not use KVM",
                snapshot_body=body,
                subject_id="kvm-negated",
                evidence_subject_id="kvm-negated",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="independently_verified",
                fetched_at="2026-09-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope="provider",
            )
        )
        self.assertFalse(result.accepted)
        self.assertEqual(result.knowledge_state, "confirmed_absent")

    def test_office_address_cannot_prove_exact_dc(self):
        body = _body("office-address.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="Our sales office is at 12 Orchard Road, Singapore",
                snapshot_body=body,
                subject_id="harbour",
                evidence_subject_id="harbour",
                claim_type="facility",
                claim_value="Orchard DC",
                knowledge_state="present",
                assessment_state="extracted",
                fetched_at="2026-09-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="official",
                evidence_kind="office_address",
                claimed_scope="facility_exact",
            )
        )
        self.assertFalse(result.accepted)
        self.assertTrue(any("office" in r for r in result.reasons))

    def test_stale_evidence_is_not_current(self):
        body = _body("stale-evidence.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="Hypervisor: KVM.",
                snapshot_body=body,
                subject_id="stale-rack",
                evidence_subject_id="stale-rack",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="independently_verified",
                fetched_at="2022-03-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope="provider",
            )
        )
        self.assertFalse(result.accepted)
        self.assertTrue(any("stale" in r for r in result.reasons))
        self.assertEqual(result.assessment_state, "rejected")

    def test_replay_clock_does_not_refresh_stale_evidence(self):
        body = _body("stale-evidence.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="Hypervisor: KVM.",
                snapshot_body=body,
                subject_id="stale-rack",
                evidence_subject_id="stale-rack",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="extracted",
                fetched_at="2022-03-01T00:00:00Z",
                recorded_at="2026-09-09T04:00:00Z",
                now="2026-09-09T04:00:00Z",
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope="provider",
            )
        )
        self.assertFalse(result.accepted)

    def test_disagreement_is_conflict_not_majority(self):
        body = _body("ok-200.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="Hypervisor: KVM",
                snapshot_body=body,
                subject_id="local-packages",
                evidence_subject_id="local-packages",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="extracted",
                fetched_at="2026-09-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="official",
                evidence_kind="provider_page",
                claimed_scope="provider",
                peer_knowledge_states=("confirmed_absent", "present", "present"),
            )
        )
        self.assertEqual(result.knowledge_state, "conflicting")
        self.assertTrue(result.review_required)
        self.assertFalse(result.accepted)

    def test_third_party_cannot_independently_verify(self):
        body = _body("ok-200.html")
        result = verify_claim(
            VerificationRequest(
                excerpt="Hypervisor: KVM",
                snapshot_body=body,
                subject_id="local-packages",
                evidence_subject_id="local-packages",
                claim_type="hypervisor",
                claim_value="KVM",
                knowledge_state="present",
                assessment_state="independently_verified",
                fetched_at="2026-09-01T00:00:00Z",
                recorded_at="2026-09-09T00:00:00Z",
                now="2026-09-09T00:00:00Z",
                source_authority="third_party",
                evidence_kind="provider_page",
                claimed_scope="provider",
            )
        )
        self.assertTrue(result.review_required)
        self.assertEqual(result.assessment_state, "extracted")
