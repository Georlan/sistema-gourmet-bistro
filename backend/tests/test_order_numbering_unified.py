from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app  # noqa: F401 - carrega a aplicação e seus modelos
from app.models import Restaurante
from app.operational_models import NumeradorOperacional
from app.routes import cardapio, orders


TENANT = 1972


def test_salao_caixa_e_cardapio_use_the_same_atomic_human_number_allocator():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(TENANT)
    db = SessionLocal()
    try:
        db.query(NumeradorOperacional).filter(
            NumeradorOperacional.restaurante_id == TENANT
        ).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == TENANT).delete(synchronize_session=False)
        db.commit()
        db.add(Restaurante(id=TENANT, nome="Restaurante Numbering", plano="bistro"))
        db.commit()

        assert orders.gerar_novo_numero_pedido is cardapio.gerar_novo_numero_pedido

        mesa_ou_caixa = orders.gerar_novo_numero_pedido(db)
        delivery_ou_retirada = cardapio.gerar_novo_numero_pedido(db)
        outro_pedido = orders.gerar_novo_numero_pedido(db)

        assert delivery_ou_retirada == mesa_ou_caixa + 1
        assert outro_pedido == delivery_ou_retirada + 1
        db.commit()

        counter = db.query(NumeradorOperacional).filter(
            NumeradorOperacional.restaurante_id == TENANT
        ).one()
        assert counter.ultimo_numero == outro_pedido
    finally:
        db.close()
        current_restaurante_id.reset(token)
