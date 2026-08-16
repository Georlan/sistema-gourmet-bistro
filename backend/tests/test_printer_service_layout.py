import datetime

from app.printer_service import ESC_BOLD_ON, ESC_FONT_A, PrinterService


def _service() -> PrinterService:
    service = object.__new__(PrinterService)
    service.width = 40
    service.simulate = False
    return service


def test_local_automatic_ticket_is_exactly_the_full_receipt_template():
    service = _service()
    automatic = service.generate_kitchen_ticket(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        restaurant_name="Pizzaria Bella Italia",
        items=[
            {
                "codigo": "003",
                "nome": "003 - Cheese Bacon",
                "observacao": "sem bacon",
                "cliente_nome": "Paulo",
                "preco_unit": 25.0,
            },
            {
                "codigo": "003",
                "nome": "003 - Cheese Bacon",
                "observacao": "sem bacon",
                "cliente_nome": "paulo",
                "preco_unit": 25.0,
            },
            {
                "codigo": "001",
                "nome": "Hambúrguer Tradicional",
                "observacao": "sem cheddar",
                "cliente_nome": "Consumo Geral",
                "preco_unit": 19.0,
            },
        ],
    )
    full_receipt = service.generate_receipt(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        print_header="Pizzaria Bella Italia",
        taxa_servico_ativa=False,
        apenas_valores=False,
        comandas_details=[
            {
                "identificador": "Consumo Geral",
                "itens": [
                    {
                        "codigo": "003",
                        "produto": {"id": "003", "nome": "003 - Cheese Bacon"},
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "Paulo",
                        "observacao": "sem bacon",
                    },
                    {
                        "codigo": "003",
                        "produto": {"id": "003", "nome": "003 - Cheese Bacon"},
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "paulo",
                        "observacao": "sem bacon",
                    },
                    {
                        "codigo": "001",
                        "produto": {"id": "001", "nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                        "cliente_nome": "Consumo Geral",
                        "observacao": "sem cheddar",
                    },
                ],
            }
        ],
    )

    assert automatic == full_receipt
    assert automatic.count("CLIENTE: PAULO") == 1
    assert "CLIENTE: CONSUMO GERAL" not in automatic
    assert "2x CHEESE BACON" in automatic
    assert "R$ 50,00" in automatic
    assert "R$ 19,00" in automatic
    assert "003 -" not in automatic
    assert "OBS: SEM BACON" in automatic
    assert "TOTAL GERAL DA MESA:" in automatic
    assert "R$ 69,00" in automatic
    assert "Gerenciado por Kôma" in automatic
    assert "Documento não fiscal" in automatic


def test_local_reprint_is_same_document_without_second_layout_or_marker():
    service = _service()
    args = {
        "num_pedido": 42,
        "tipo": "Consumo no Local",
        "mesa_id": 10,
        "garcom_nome": "Georlan",
        "items": [
            {
                "codigo": "001",
                "nome": "Hambúrguer Bovino",
                "cliente_nome": "A",
                "preco_unit": 19.0,
            }
        ],
    }
    original = service.generate_kitchen_ticket(**args, is_reprint=False)
    reprint = service.generate_kitchen_ticket(**args, is_reprint=True)

    assert reprint == original
    assert "REIMPRESSÃO" not in reprint
    assert "CLIENTE: A" in reprint
    assert "1x HAMBÚRGUER BOVINO" in reprint
    assert "SUBTOTAL A" in reprint
    assert "TOTAL GERAL DA MESA:" in reprint
    assert "R$ 19,00" in reprint


def test_values_receipt_groups_quantity_and_shows_each_person_subtotal():
    ticket = _service().generate_receipt(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        opened_at=datetime.datetime(2026, 7, 28, 18, 0),
        print_header="Pizzaria Bella Italia",
        taxa_servico_ativa=False,
        apenas_valores=True,
        comandas_details=[
            {
                "identificador": "Consumo Geral",
                "itens": [
                    {
                        "codigo": "001",
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                        "cliente_nome": "Consumo Geral",
                    },
                    {
                        "codigo": "001",
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                        "cliente_nome": "consumo geral",
                    },
                    {
                        "codigo": "001",
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

    assert "CLIENTE: CONSUMO GERAL" not in ticket
    assert ticket.count("CLIENTE: PAULO") == 1
    assert "3x HAMBÚRGUER TRADICIONAL" in ticket
    assert "001 -" not in ticket
    assert "R$ 57,00" in ticket
    assert "SUBTOTAL CONSUMO GERAL" in ticket
    assert "SUBTOTAL PAULO" in ticket
    assert "R$ 25,00" in ticket
    assert "PIZZARIA BELLA ITALIA" not in ticket
    assert "FECHAMENTO" in ticket
    assert "CONSUMO NO LOCAL" not in ticket
    assert "PEDIDO: #305" not in ticket
    assert "GARÇOM: GEORLAN" not in ticket
    assert "DATA:" not in ticket
    assert "MESA: 3" in ticket
    assert "ABERTURA: 18:00" in ticket
    assert "R$ 82,00" in ticket
    assert f"{ESC_BOLD_ON}3x HAMBÚRGUER TRADICIONAL" in ticket


def test_full_receipt_keeps_complete_header():
    ticket = _service().generate_receipt(
        num_pedido=305,
        tipo="Consumo no Local",
        mesa_id=3,
        garcom_nome="Georlan",
        opened_at=datetime.datetime(2026, 7, 28, 18, 0),
        print_header="Pizzaria Bella Italia",
        taxa_servico_ativa=False,
        apenas_valores=False,
        comandas_details=[
            {
                "itens": [
                    {
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                    }
                ]
            }
        ],
    )

    assert "PIZZARIA BELLA ITALIA" in ticket
    assert "CONSUMO NO LOCAL" in ticket
    assert "PEDIDO: #305" in ticket
    assert "MESA: 3" in ticket
    assert "GARÇOM: Georlan" in ticket
    assert "TOTAL GERAL DA MESA:" in ticket
    assert "ABERTURA:" not in ticket


def test_receipt_omits_general_subtotal_when_table_has_no_named_clients():
    ticket = _service().generate_receipt(
        num_pedido=306,
        tipo="Consumo no Local",
        mesa_id=4,
        garcom_nome="Georlan",
        taxa_servico_ativa=False,
        comandas_details=[
            {
                "identificador": "Consumo Geral",
                "itens": [
                    {
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                    },
                    {
                        "produto": {"nome": "Hambúrguer Tradicional"},
                        "preco_unit": 19.0,
                        "status": "preparando",
                    },
                ],
            }
        ],
    )

    assert "CLIENTE: CONSUMO GERAL" not in ticket
    assert "SUBTOTAL" not in ticket
    assert "2x HAMBÚRGUER TRADICIONAL" in ticket
    assert "TOTAL GERAL DA MESA:" in ticket
    assert "R$ 38,00" in ticket


def test_full_receipt_keeps_distinct_notes():
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
                        "produto": {"nome": "003 - Cheese Bacon"},
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "Paulo",
                        "observacao": "sem bacon",
                    },
                    {
                        "codigo": "003",
                        "produto": {"nome": "003 - Cheese Bacon"},
                        "preco_unit": 25.0,
                        "status": "preparando",
                        "cliente_nome": "Paulo",
                        "observacao": "com bacon",
                    },
                ],
            }
        ],
    )

    assert ticket.count("1x CHEESE BACON") == 2
    assert "003 -" not in ticket
    assert "OBS: SEM BACON" in ticket
    assert "OBS: COM BACON" in ticket
    assert f"{ESC_FONT_A}   OBS: SEM BACON{ESC_FONT_A}" in ticket


def test_receipt_emphasizes_delivery_and_retirada_without_mode_title():
    service = _service()
    base_args = {
        "num_pedido": 7,
        "mesa_id": None,
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
        "taxa_servico_ativa": False,
    }

    retirada = service.generate_receipt(
        **base_args,
        tipo="viagem",
        apenas_valores=False,
    )
    delivery = service.generate_receipt(
        **base_args,
        tipo="delivery",
        apenas_valores=True,
    )

    assert "RETIRADA" in retirada
    assert "DELIVERY" in delivery
    assert "COMANDA" not in retirada
    assert "COMANDA" not in delivery


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
