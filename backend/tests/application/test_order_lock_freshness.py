from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from app.application.orders.service import OrderApplicationService
from app.models import Comanda, Lancamento


def test_resolver_refreshes_launch_after_waiting_for_check_lock():
    """A sessão perdedora não pode seguir com Lancamento carregado antes do lock.

    Reproduz o interleaving crítico: a sessão B leu o lançamento como pendente,
    ficou esperando o lock da Comanda enquanto A avançou o pedido e, ao acordar,
    precisa reler o status já persistido antes de validar outra transição.
    """
    db = MagicMock(spec=Session)
    lancamento = MagicMock(spec=Lancamento)
    lancamento.id = "l-race"
    lancamento.comanda_id = "c-race"
    lancamento.status = "pendente"

    comanda = MagicMock(spec=Comanda)
    comanda.id = "c-race"

    launch_query = MagicMock()
    check_query = MagicMock()
    db.query.side_effect = [launch_query, check_query]
    launch_query.filter.return_value.first.return_value = lancamento
    check_query.filter.return_value.with_for_update.return_value.first.return_value = comanda

    refresh_order = []

    def refresh(entity):
        refresh_order.append(entity)
        if entity is lancamento:
            # Estado que a sessão vencedora persistiu enquanto B esperava o lock.
            lancamento.status = "producao"

    db.refresh.side_effect = refresh

    resolved_launch, resolved_check = OrderApplicationService._resolve_lancamento_and_comanda(
        db,
        restaurant_id=1,
        order_id="l-race",
    )

    assert resolved_check is comanda
    assert resolved_launch is lancamento
    assert resolved_launch.status == "producao"
    assert refresh_order == [comanda, lancamento]
