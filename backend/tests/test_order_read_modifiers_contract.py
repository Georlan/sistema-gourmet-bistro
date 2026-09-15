from app.schemas import ItemModifierResponse, ItemResponse


def test_item_response_exposes_modifier_contract():
    modifier = ItemModifierResponse(id="egg", nome="Ovo", preco=2.0)
    item = ItemResponse(
        id="item-1",
        comanda_id="order-1",
        lancamento_id="launch-1",
        produto_id="burger-1",
        preco_unit=21.0,
        observacao="",
        cliente_nome="Consumo Geral",
        status="preparando",
        pago=False,
        modificadores=[modifier],
    )

    assert item.model_dump()["modificadores"] == [
        {"id": "egg", "nome": "Ovo", "preco": 2.0}
    ]
