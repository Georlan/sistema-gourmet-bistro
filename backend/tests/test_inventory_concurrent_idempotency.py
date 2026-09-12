from types import SimpleNamespace

from app.models import Insumo, MovimentacaoEstoque, Produto, ProdutoInsumo
from app.services.inventory import consumir_estoque_dos_itens


class _Query:
    def __init__(self, db, entity):
        self.db = db
        self.entity = entity
        self.locked = False

    def filter(self, *args, **kwargs):
        return self

    def with_for_update(self):
        self.locked = True
        self.db.lock_acquired = True
        return self

    def all(self):
        if self.entity is ProdutoInsumo:
            return [self.db.recipe]
        return []

    def first(self):
        if self.entity is Produto:
            return self.db.product
        if self.entity is Insumo:
            assert self.locked, "o saldo deve ser relido sob row lock"
            return self.db.stock
        # A consulta usa MovimentacaoEstoque.id. Antes do row lock simulamos a
        # visão stale da segunda transação; depois do lock ela enxerga o commit
        # da primeira transação.
        if self.entity is MovimentacaoEstoque.id:
            if not self.db.lock_acquired:
                return None
            return ("existing-movement",) if self.db.movement_exists else None
        return None


class _ConcurrentRetrySession:
    def __init__(self):
        self.lock_acquired = False
        self.movement_exists = True
        self.stock = SimpleNamespace(
            id="ins-1",
            estoque_atual=8.0,
            preco_medio_custo=3.0,
        )
        self.recipe = SimpleNamespace(insumo_id="ins-1", quantidade=2.0)
        self.product = SimpleNamespace(nome="Produto")
        self.added = []

    def query(self, entity):
        return _Query(self, entity)

    def add(self, entity):
        self.added.append(entity)


def test_retry_concorrente_revalida_idempotencia_depois_do_row_lock():
    """A segunda transação não pode repetir a baixa após aguardar o insumo.

    Cenário reproduzido: a primeira transação já commitou uma baixa 10 -> 8.
    A segunda começou antes desse commit e teria uma visão stale sem movimento.
    O row lock precisa vir antes da consulta idempotente para que ela revalide o
    estado após a espera e preserve saldo 8 em vez de aplicar 8 -> 6.
    """
    db = _ConcurrentRetrySession()
    item = SimpleNamespace(
        id="item-1",
        restaurante_id=1,
        produto_id="prod-1",
        comanda_id="cmd-1",
    )

    consumir_estoque_dos_itens(
        db,
        [item],
        usuario_id="u-1",
        liberar_pendente=True,
    )

    assert db.lock_acquired is True
    assert db.stock.estoque_atual == 8.0
    assert db.added == []
