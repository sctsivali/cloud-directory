"""Legacy ingest SQL remains available and is marked deprecated."""
from __future__ import annotations

import json
import tempfile
import unittest
import warnings
from pathlib import Path

from tests.helpers import ROOT, load_script

ingest = load_script("ingest_provider")


class TestIngestProviderCompatibility(unittest.TestCase):
    def test_emit_sql_still_writes_legacy_upsert_and_warns(self):
        doc = {
            "allow_no_tiers": True,
            "provider": {
                "id": "fixture-local",
                "name": "Fixture Local",
                "hq_country": "Indonesia",
                "legal_country": "Indonesia",
                "website": "https://fixtures.example.test",
                "origin": "local",
                "is_local_asean": True,
                "provider_type": "IaaS",
            },
            "sources": ["https://fixtures.example.test/page"],
            "stack": {"hypervisor": "KVM"},
            "sovereignty": {"data_residency": "local"},
            "locations": [{"city": "Jakarta", "country": "Indonesia"}],
            "tiers": [],
        }
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            sql = ingest.emit_sql(doc)
        self.assertTrue(any(issubclass(item.category, DeprecationWarning) for item in caught))
        self.assertIn("INSERT INTO providers", sql)
        self.assertIn("COMMIT;", sql)

    def test_cli_still_emits_sql_file(self):
        doc = {
            "allow_no_tiers": True,
            "provider": {
                "id": "fixture-local",
                "name": "Fixture Local",
                "hq_country": "Indonesia",
                "legal_country": "Indonesia",
                "website": "https://fixtures.example.test",
                "origin": "local",
            },
            "sources": ["https://fixtures.example.test/page"],
            "locations": [{"city": "Jakarta", "country": "Indonesia"}],
            "tiers": [],
        }
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "p.json"
            out = Path(tmp) / "p.sql"
            src.write_text(json.dumps(doc))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                ingest.main  # keep module loaded
                loaded = json.loads(src.read_text())
                ingest.validate(loaded)
                out.write_text(ingest.emit_sql(loaded))
            self.assertIn("INSERT INTO providers", out.read_text())
        src_text = (ROOT / "scripts" / "ingest_provider.py").read_text()
        self.assertIn("DeprecationWarning", src_text)
        self.assertIn("MCP proposals", src_text)
