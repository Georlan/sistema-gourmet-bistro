import inspect

from app.models import Comanda
from app.routes import tables


def test_full_table_cancellation_batch_loads_items_before_iteration():
    """Keep item loading O(1) in SELECT count as open checks grow.

    ``Comanda.itens`` is intentionally a lazy relationship. Without an explicit
    loader option, iterating ``comanda.itens`` over N open checks issues up to N
    extra SELECTs. The full-table cancellation path must batch that relationship
    before its nested iteration.
    """
    assert Comanda.itens.property.lazy == "select"

    source = inspect.getsource(tables.cancelar_consumo_mesa)
    assert ".options(selectinload(Comanda.itens))" in source
    assert "for item in comanda.itens" in source
