from pathlib import Path

from app.application.printing.engine import PrintEngineType, resolve_order_engine


BACKEND_ROOT = Path(__file__).resolve().parents[1]

MIGRATED_PRINT_PRODUCERS = (
    "app/adapters/orders/pos_adapter.py",
    "app/adapters/orders/waiter_adapter.py",
    "app/routes/orders.py",
    "app/routes/atendimentos.py",
    "app/routes/atendimento_printing.py",
    "app/routes/printing.py",
)

FORBIDDEN_OUTSIDE_PRINT_CORE = (
    "PrintJob(",
    "PrintDocumentService",
    "enqueue_table_receipt(",
    "generate_kitchen_ticket",
    "generate_delivery_unified_ticket",
    "generate_delivery_kitchen_ticket",
    "generate_delivery_motoboy_ticket",
    "print_in_background",
)

SUPERSEDED_ORDERS_CORE_PRINT_PATHS = (
    "MENSAGEM_WHATSAPP_PRONTO_RETIRADA",
    "MENSAGEM_WHATSAPP_SAIU_ENTREGA",
    "MENSAGEM_WHATSAPP_RECUSADO",
    "_get_print_preferences",
    "enqueue_print_job_in_session",
    "enqueue_initial_production_for_order",
    "reimprimir_lancamento_cozinha",
)


def test_migrated_producers_only_declare_print_intent():
    violations: dict[str, list[str]] = {}
    for relative_path in MIGRATED_PRINT_PRODUCERS:
        source = (BACKEND_ROOT / relative_path).read_text(encoding="utf-8")
        found = [token for token in FORBIDDEN_OUTSIDE_PRINT_CORE if token in source]
        if found:
            violations[relative_path] = found
        assert "PrintingApplicationService" in source

    assert violations == {}


def test_orders_core_does_not_restore_superseded_printing_paths():
    source = (BACKEND_ROOT / "app/routes/orders_core.py").read_text(encoding="utf-8")
    found = [token for token in SUPERSEDED_ORDERS_CORE_PRINT_PATHS if token in source]
    assert found == []


def test_order_engine_resolver_is_semantic_not_channel_based():
    assert resolve_order_engine("Consumo no Local") == PrintEngineType.DINE_IN_ORDER
    assert resolve_order_engine("Retirada") == PrintEngineType.PICKUP_ORDER
    assert resolve_order_engine("Balcão") == PrintEngineType.PICKUP_ORDER
    assert resolve_order_engine("Delivery") == PrintEngineType.DELIVERY_ORDER
    assert resolve_order_engine("Entrega") == PrintEngineType.DELIVERY_ORDER


def test_orders_lifecycle_has_no_legacy_initial_or_dispatch_printer_imports():
    source = (BACKEND_ROOT / "app/routes/orders.py").read_text(encoding="utf-8")
    assert "enqueue_initial_production_for_order" not in source
    assert "reimprimir_lancamento_cozinha" not in source
    assert "printer_service" not in source
