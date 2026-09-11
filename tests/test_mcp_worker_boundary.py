"""Workers may only invoke directory.propose_* over MCP. No SQL proposal path."""
from __future__ import annotations

import ast
import inspect
import unittest
from pathlib import Path

from workers.mcp_submit import (
    FORBIDDEN_TOOL_NAMES,
    IDENTITY_FIELDS,
    McpProposalClient,
    PROPOSAL_TOOLS,
    PUBLICATION_TOOLS,
    ProposalSubmitError,
    TestOnlyInMemoryMcpTransport,
)
from workers.orchestrator import run_collection_task

ROOT = Path(__file__).resolve().parents[1]
WORKERS = ROOT / "workers"


def _production_worker_files() -> list[Path]:
    files = []
    for path in WORKERS.rglob("*.py"):
        rel = path.relative_to(WORKERS).as_posix()
        if path.name.startswith("test_") or "/tests/" in f"/{rel}/":
            continue
        files.append(path)
    return files


def _directory_literals(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("directory."):
            found.append(node.value)
    return found


class RecordingTransport:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append({"name": name, "arguments": dict(arguments)})
        return {
            "outcome": "created",
            "proposal": {"id": "prop-record", "actorId": "server-bound", "status": "pending_review"},
        }


class TestMcpProposalClientContract(unittest.TestCase):
    def test_invoke_does_not_accept_actor_identity(self):
        params = inspect.signature(McpProposalClient.invoke).parameters
        self.assertNotIn("actor_id", params)
        self.assertNotIn("actorId", params)
        self.assertIn("idempotency_key", params)

    def test_identity_is_bound_by_transport_server_config_not_payload(self):
        transport = TestOnlyInMemoryMcpTransport(principal_id="stdio-principal")
        client = McpProposalClient(transport)
        result = client.invoke(
            "directory.propose_claim",
            {
                "subjectType": "provider",
                "subjectId": "local-packages",
                "claimType": "hypervisor",
                "value": {"text": "KVM"},
                "knowledgeState": "present",
                "assessmentState": "extracted",
            },
            idempotency_key="k-bound",
        )
        self.assertEqual(result.outcome, "created")
        row = transport.rows["k-bound"]
        self.assertEqual(row["actor_id"], "stdio-principal")
        self.assertNotIn("actorId", transport.calls[0]["arguments"])
        self.assertNotIn("actor_id", transport.calls[0]["arguments"])

    def test_model_supplied_actor_id_is_rejected_before_transport(self):
        transport = RecordingTransport()
        client = McpProposalClient(transport)
        with self.assertRaises(ProposalSubmitError):
            client.invoke(
                "directory.propose_claim",
                {"subjectType": "provider", "actorId": "victim-editor"},
                idempotency_key="k-spoof",
            )
        self.assertEqual(transport.calls, [])

    def test_publication_and_sql_tools_are_rejected(self):
        transport = RecordingTransport()
        client = McpProposalClient(transport)
        for name in sorted(PUBLICATION_TOOLS | FORBIDDEN_TOOL_NAMES):
            with self.subTest(name=name):
                with self.assertRaises(ProposalSubmitError):
                    client.invoke(name, {}, idempotency_key="k-pub")
        self.assertEqual(transport.calls, [])

    def test_only_proposal_tools_reach_the_transport(self):
        transport = RecordingTransport()
        client = McpProposalClient(transport)
        for name in sorted(PROPOSAL_TOOLS):
            client.invoke(name, {"marker": name}, idempotency_key=f"k-{name}")
        self.assertEqual([call["name"] for call in transport.calls], sorted(PROPOSAL_TOOLS))
        for call in transport.calls:
            self.assertTrue(set(IDENTITY_FIELDS).isdisjoint(call["arguments"]))


class TestWorkerHasNoDirectPublicationPath(unittest.TestCase):
    def test_production_workers_have_no_sql_or_repository_proposal_path(self):
        sql = (
            "insert into proposals",
            "insert into revisions",
            "insert into proposal_reviews",
            "pgproposalsink",
            "memoryproposalsink",
        )
        for path in _production_worker_files():
            text = path.read_text(encoding="utf-8").lower()
            for needle in sql:
                with self.subTest(path=str(path.relative_to(ROOT)), needle=needle):
                    self.assertNotIn(needle, text)

    def test_orchestrator_only_invokes_allowed_propose_tools(self):
        orchestrator = WORKERS / "orchestrator.py"
        tools = _directory_literals(orchestrator)
        self.assertTrue(tools)
        self.assertTrue(all(name in PROPOSAL_TOOLS for name in tools))
        source = orchestrator.read_text(encoding="utf-8")
        self.assertIn("proposals.invoke(", source)
        self.assertNotIn("actor_id=", source)
        self.assertNotIn("actorId", source)
        tree = ast.parse(source)
        invoke_names: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "invoke":
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    invoke_names.append(node.args[0].value)
                keywords = {kw.arg for kw in node.keywords}
                self.assertNotIn("actor_id", keywords)
        self.assertTrue(invoke_names)
        self.assertTrue(all(name in PROPOSAL_TOOLS for name in invoke_names))
        self.assertNotIn("directory.publish_revision", invoke_names)
        self.assertNotIn("directory.publish_change", invoke_names)

    def test_test_only_fake_is_the_only_in_memory_mcp_stand_in(self):
        submit = (WORKERS / "mcp_submit.py").read_text(encoding="utf-8")
        self.assertIn("class TestOnlyInMemoryMcpTransport", submit)
        self.assertIn("TEST-ONLY", submit)
        self.assertNotIn("class PgProposalSink", submit)
        self.assertNotIn("class MemoryProposalSink", submit)
        self.assertIn("class LiveStdioMcpTransport", submit)
        self.assertIn("live MCP transport is disabled", submit)
        doc = inspect.getdoc(TestOnlyInMemoryMcpTransport) or ""
        self.assertIn("TEST-ONLY", doc)
        self.assertIsNotNone(inspect.getsource(run_collection_task))
