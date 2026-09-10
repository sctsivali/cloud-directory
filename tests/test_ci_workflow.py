from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def test_python_database_dependency_is_installed_before_node_integration_tests() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    install_python = workflow.index("python -m pip install pytest \"psycopg[binary]\"")
    node_tests = workflow.index("run: npm test")

    assert install_python < node_tests, (
        "Node integration tests invoke scripts/migrate.py, so psycopg must be "
        "installed before npm test runs"
    )
