from app.printer_service import PrinterService


def _service() -> PrinterService:
    service = object.__new__(PrinterService)
    service.width = 40
    service.simulate = False
    return service


def test_kitchen_ticket_groups_people_and_repeated_items_once():
    ticket = _service().generate_kitchen_ticket(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        restaurant_name="Pizzaria Bella Italia",
        items=[
            {
                "codigo": "003",
                "nome": "Cheese Bacon",
                "descricao": "Hambúrguer bovino, queijo e bacon.",
                "observacao": "sem bacon",
                "cliente_nome": "Paulo",
            },
            {
                "codigo": "003",
                "nome": "Cheese Bacon",
                "descricao": "Hambúrguer bovino, queijo e bacon.",
                "observacao": "sem bacon",
                "cliente_nome": "paulo",
            },
            {
                "codigo": "001",
                "nome": "Hambúrguer Tradicional",
                "observacao": "sem cheddar",
                "cliente_nome": "Consumo Geral",
            },
        ],
    )

    assert ticket.count("CLIENTE: PAULO") == 1
    assert "[PAULO]" not in ticket
    assert "2x 003 - Cheese Bacon" in ticket
    assert "DESCRIÇÃO: Hambúrguer bovino" in ticket
    assert "OBS: SEM BACON" in ticket
    assert "TOTAL DE ITENS:" in ticket
    assert "3" in ticket
    assert "PIZZARIA BELLA ITALIA" in ticket


def test_values_receipt_groups_quantity_and_shows_each_person_subtotal():
    ticket = _service().generate_receipt(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        print_header="Pizzaria Bella Italia",
        taxa_servico_ativa=False,
        apenas_valores=True,
        comandas_details=[
            {
                "identificador": "Consumo Geral",
                "itens": [
                    {
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                        "cliente_nome": "Consumo Geral",
                    },
                    {
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                        "cliente_nome": "consumo geral",
                    },
                    {
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                        "cliente_nome": "Consumo Geral",
                    },
                    {
                        "produto": {"nome": "Cheese Bacon"},
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "Paulo",
                    },
                ],
            }
        ],
    )

    assert ticket.count("CLIENTE: CONSUMO GERAL") == 1
    assert ticket.count("CLIENTE: PAULO") == 1
    assert "3x HAMBÚRGUER TRADICIONAL" in ticket
    assert "R$ 57,00" in ticket
    assert "SUBTOTAL CONSUMO GERAL" in ticket
    assert "R$ 57,00" in ticket
    assert "SUBTOTAL PAULO" in ticket
    assert "R$ 25,00" in ticket
    assert "TOTAL DE ITENS:" in ticket
    assert "R$ 82,00" in ticket


def test_full_receipt_keeps_product_description_and_distinct_notes():
    ticket = _service().generate_receipt(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        taxa_servico_ativa=False,
        comandas_details=[
            {
                "identificador": "Paulo",
                "itens": [
                    {
                        "codigo": "003",
                        "produto": {
                            "nome": "Cheese Bacon",
                            "descricao": "Hambúrguer bovino e queijo.",
                        },
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "Paulo",
                        "observacao": "sem bacon",
                    },
                    {
                        "codigo": "003",
                        "produto": {
                            "nome": "Cheese Bacon",
                            "descricao": "Hambúrguer bovino e queijo.",
                        },
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "Paulo",
                        "observacao": "com bacon",
                    },
                ],
            }
        ],
    )

    assert ticket.count("1 x 003 - CHEESE BACON") == 2
    assert "DESCRIÇÃO: Hambúrguer bovino" in ticket
    assert "OBS: SEM BACON" in ticket
    assert "OBS: COM BACON" in ticket


def test_restaurant_name_can_move_to_footer_or_be_hidden():
    service = _service()
    base_args = {
        "num_pedido": 1,
        "tipo": "Consumo no Local",
        "mesa_id": 1,
        "garcom_nome": "Caixa",
        "comandas_details": [
            {
                "itens": [
                    {
                        "produto": {"nome": "Água"},
                        "preco_unit": 5.0,
                        "status": "preparando",
                    }
                ]
            }
        ],
        "print_header": "Meu Restaurante",
        "taxa_servico_ativa": False,
    }

    footer_ticket = service.generate_receipt(
        **base_args,
        restaurant_name_position="rodape",
    )
    hidden_ticket = service.generate_receipt(
        **base_args,
        restaurant_name_position="oculto",
    )

    assert footer_ticket.index("MEU RESTAURANTE") > footer_ticket.index(
        "TOTAL GERAL DA MESA"
    )
    assert "MEU RESTAURANTE" not in hidden_ticket
