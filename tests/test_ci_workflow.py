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


def test_legacy_migration_loader_registers_module_before_dataclass_import() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    create_module = workflow.index("migrate = importlib.util.module_from_spec(spec)")
    register_module = workflow.index("sys.modules[spec.name] = migrate")
    execute_module = workflow.index("spec.loader.exec_module(migrate)")

    assert create_module < register_module < execute_module, (
        "Python 3.11 dataclasses require dynamically loaded modules to be "
        "registered in sys.modules before exec_module"
    )
