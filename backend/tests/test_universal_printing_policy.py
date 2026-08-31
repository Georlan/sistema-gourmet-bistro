from app.domain.printing import OrderPrintData, PrintDocumentService, PrintItem


def _item(code: str, name: str, destination: str, price: float = 5.0) -> PrintItem:
    return PrintItem(
        codigo=code,
        nome=name,
        quantidade=1,
        preco_unit=price,
        cliente_nome="GEORLAN",
        destino_impressao=destination,
    )


def _without_reprint_marker(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if line.strip() != "REIMPRESSÃO"
    )


def test_local_only_no_destination_keeps_silent_waiter_rule():
    order = OrderPrintData(
        numero_pedido="201",
        tipo_pedido="Consumo no Local",
        mesa="8",
        itens=[_item("010", "Água de coco", "NENHUM")],
    )

    assert PrintDocumentService.generate_production(order) is None


def test_pickup_only_no_destination_still_creates_operational_ticket():
    order = OrderPrintData(
        numero_pedido="202",
        tipo_pedido="Retirada",
        mesa="BALCAO",
        itens=[
            _item("010", "Água de coco", "NENHUM"),
            _item("011", "Água mineral", "NENHUM", 4.0),
        ],
    )

    docs = PrintDocumentService.generate_production(order)

    assert docs is not None
    assert set(docs) == {"COZINHA"}
    text = docs["COZINHA"]
    assert "PED #202" in text
    assert "MESA BALCAO" in text
    assert "RETIRADA" in text
    assert "ÁGUA DE COCO" in text
    assert "ÁGUA MINERAL" in text


def test_pickup_mixed_order_keeps_no_destination_item_on_primary_ticket():
    order = OrderPrintData(
        numero_pedido="203",
        tipo_pedido="Retirada",
        mesa="BALCAO",
        itens=[
            _item("006", "Burguer Por do Sol", "COZINHA", 34.0),
            _item("010", "Água de coco", "NENHUM"),
        ],
    )

    docs = PrintDocumentService.generate_production(order)

    assert docs is not None
    assert set(docs) == {"COZINHA"}
    assert "BURGUER POR DO SOL" in docs["COZINHA"]
    assert "ÁGUA DE COCO" in docs["COZINHA"]


def test_delivery_no_destination_item_does_not_duplicate_across_sectors():
    order = OrderPrintData(
        numero_pedido="204",
        tipo_pedido="Delivery",
        mesa="BALCAO",
        itens=[
            _item("001", "Hambúrguer", "COZINHA", 20.0),
            _item("002", "Drink", "BAR", 15.0),
            _item("010", "Água", "NENHUM", 4.0),
        ],
    )

    docs = PrintDocumentService.generate_production(order)

    assert docs is not None
    assert set(docs) == {"COZINHA", "BAR"}
    assert "ÁGUA" in docs["COZINHA"]
    assert "ÁGUA" not in docs["BAR"]
    assert "HAMBÚRGUER" in docs["COZINHA"]
    assert "DRINK" in docs["BAR"]


def test_reprint_uses_same_canonical_layout_with_explicit_marker():
    base = OrderPrintData(
        numero_pedido="205",
        tipo_pedido="Retirada",
        mesa="BALCAO",
        horario="18:56",
        garcom_nome="Admin",
        itens=[_item("010", "Água de coco", "NENHUM")],
    )
    reprint = OrderPrintData(
        restaurante_nome=base.restaurante_nome,
        numero_pedido=base.numero_pedido,
        tipo_pedido=base.tipo_pedido,
        mesa=base.mesa,
        horario=base.horario,
        garcom_nome=base.garcom_nome,
        itens=base.itens,
        is_reprint=True,
    )

    original_text = PrintDocumentService.generate_production(base)["COZINHA"]
    reprint_text = PrintDocumentService.generate_production(reprint)["COZINHA"]

    assert "REIMPRESSÃO" not in original_text
    assert "REIMPRESSÃO" in reprint_text
    assert _without_reprint_marker(reprint_text) == original_text
