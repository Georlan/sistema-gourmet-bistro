from __future__ import annotations

from sqlalchemy.orm import Session

from ..database import current_restaurante_id
from .atendimentos import allocate_account_number


def gerar_novo_numero_pedido_atomico(db: Session) -> int:
    """Fonte única transitória para todos os números humanos de pedido/conta.

    O código legado ainda chama `gerar_novo_numero_pedido` em mais de um router
    (salão/caixa e cardápio público). Enquanto essas rotas não forem consolidadas
    em um único serviço de criação de pedido, todas apontam para esta função.

    Ela usa o mesmo NumeradorOperacional da família de mesa e o mesmo advisory
    lock PostgreSQL, eliminando a corrida em que Delivery #47 e Conta #47
    poderiam nascer simultaneamente a partir de dois `MAX(numero_pedido)`.
    """
    restaurante_id = current_restaurante_id.get()
    if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
        raise RuntimeError("Numeração operacional exige restaurante_id explícito no contexto")
    numero, _periodo = allocate_account_number(db, restaurante_id)
    return numero
