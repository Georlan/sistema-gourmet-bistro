from app.database import current_restaurante_id
from app.models import Usuario
from app.routes.relatorios import get_cargos_permissoes


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *_args, **_kwargs):
        return self

    def group_by(self, *_args, **_kwargs):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.query_calls = []

    def query(self, *args):
        self.query_calls.append(args)
        # A primeira consulta é a agregação por cargo. Consultas auxiliares
        # (ex.: existência de perfil Motoboy) não devem reutilizar essas linhas.
        return _FakeQuery(self.rows if len(args) > 1 else [])


def test_role_counts_are_aggregated_without_materializing_users(monkeypatch):
    """The endpoint must fetch one row per DB role, not one ORM object per employee."""
    monkeypatch.setattr("app.routes.relatorios.has_capability", lambda *_args, **_kwargs: False)
    db = _FakeSession([
        ("admin", 2),
        ("operador_caixa", 1200),
        ("caixa", 800),
        ("garcom", 3000),
        ("sommelier", 4),
    ])
    tenant_token = current_restaurante_id.set(77)
    try:
        payload = get_cargos_permissoes(db=db, current_user=object())
    finally:
        current_restaurante_id.reset(tenant_token)

    # A full-entity query (`db.query(Usuario)`) would scale ORM materialization
    # linearly with headcount. The optimized query selects aggregate expressions.
    assert db.query_calls
    aggregate_args = db.query_calls[0]
    assert all(arg is not Usuario for arg in aggregate_args)

    by_slug = {row["slug"]: row["total_funcionarios"] for row in payload["cargos"]}
    assert by_slug["admin"] == 2
    assert by_slug["caixa"] == 2000  # canonical + legacy alias merged
    assert by_slug["garcom"] == 3000
    assert by_slug["sommelier"] == 4

    # For this 5,006-employee scenario the database returns only five aggregate
    # rows to Python instead of materializing 5,006 Usuario ORM instances.
    assert len(db.rows) == 5
