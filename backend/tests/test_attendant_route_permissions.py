from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_quick_order_routes_use_focused_permission():
    modifiers = _source("backend/app/routes/modificadores.py")
    attendances = _source("backend/app/routes/atendimentos.py")
    optimization = _source("backend/app/routes/optimization.py")

    assert 'Depends(require_permission("pedidos:criar_rapido"))' in modifiers
    assert 'Depends(require_permission("pedidos:criar_rapido"))' in attendances
    assert 'Depends(require_permission("pedidos:consultar_cliente"))' in optimization
