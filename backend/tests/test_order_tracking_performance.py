import uuid

from sqlalchemy import event

from app.database import SessionLocal, engine
from app.models import Categoria, Comanda, Item, Lancamento, Produto, Restaurante, Usuario
from app.order_chat_models import OrderConversation
from app.routes import order_tracking


def _capture_selects(callable_):
    statements: list[str] = []

    def capture_selects(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_selects)
    try:
        result = callable_()
    finally:
        event.remove(engine, "before_cursor_execute", capture_selects)
    return result, statements


def test_order_tracking_query_count_does_not_scale_with_items(monkeypatch):
    suffix = uuid.uuid4().hex[:8]
    restaurante_id = 700000 + int(uuid.uuid4().hex[:5], 16) % 200000
    user_id = f"u-track-perf-{suffix}"
    category_id = f"cat-track-perf-{suffix}"
    comanda_id = f"cmd-track-perf-{suffix}"
    lancamento_id = f"lanc-track-perf-{suffix}"
    conversation_id = f"conv-track-perf-{suffix}"

    with SessionLocal() as db:
        db.add(Restaurante(id=restaurante_id, nome="Tracking Perf", slug=f"tracking-perf-{suffix}"))
        db.add(
            Usuario(
                id=user_id,
                restaurante_id=restaurante_id,
                nome="Operador Tracking",
                cargo="admin",
                role="admin",
                status="ativo",
            )
        )
        db.add(Categoria(id=category_id, restaurante_id=restaurante_id, nome=f"Categoria {suffix}"))
        db.flush()

        products = []
        for index in range(8):
            product = Produto(
                id=f"prod-track-perf-{suffix}-{index}",
                restaurante_id=restaurante_id,
                categoria_id=category_id,
                nome=f"Produto {index}",
                preco=10 + index,
            )
            products.append(product)
            db.add(product)

        db.add(
            Comanda(
                id=comanda_id,
                restaurante_id=restaurante_id,
                garcom_id=user_id,
                numero_pedido=987654,
                identificador="Cliente Performance",
                tipo="Entrega",
                delivery_status="pendente",
                fechada=False,
            )
        )
        db.add(
            Lancamento(
                id=lancamento_id,
                restaurante_id=restaurante_id,
                comanda_id=comanda_id,
                garcom_id=user_id,
                origem="cardapio",
                status="pendente",
            )
        )
        db.flush()

        for index, product in enumerate(products):
            db.add(
                Item(
                    id=f"item-track-perf-{suffix}-{index}",
                    restaurante_id=restaurante_id,
                    comanda_id=comanda_id,
                    lancamento_id=lancamento_id,
                    produto_id=product.id,
                    preco_unit=10 + index,
                    observacao="",
                    status="preparando",
                )
            )
        db.commit()

    def legacy_lazy_projection():
        with SessionLocal() as db:
            comanda = db.query(Comanda).filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.id == comanda_id,
            ).first()
            db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
            db.query(OrderConversation).filter(
                OrderConversation.restaurante_id == restaurante_id,
                OrderConversation.id == conversation_id,
            ).first()
            return [item.produto.nome for item in comanda.itens]

    legacy_names, legacy_selects = _capture_selects(legacy_lazy_projection)
    assert len(legacy_names) == 8
    assert len(legacy_selects) == 12

    monkeypatch.setattr(
        order_tracking,
        "resolve_public_tracking",
        lambda _db, _token: (restaurante_id, conversation_id, comanda_id, None),
    )

    def optimized_projection():
        with SessionLocal() as db:
            return order_tracking.consultar_pedido_por_token("opaque-test-token", db)

    payload, optimized_selects = _capture_selects(optimized_projection)

    assert len(payload["itens"]) == 8
    assert [item["nome"] for item in payload["itens"]] == [f"Produto {index}" for index in range(8)]
    assert len(optimized_selects) == 4
    assert len(optimized_selects) < len(legacy_selects)
