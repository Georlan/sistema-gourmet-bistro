from app.services.delivery_area_policy import validate_public_delivery_area


def test_delivery_area_disabled_never_blocks():
    assert validate_public_delivery_area(
        enabled=False,
        allowed_cities=[],
        allowed_neighborhoods=[],
        city="Magé",
        state="RJ",
        neighborhood="Centro",
    ) is None


def test_delivery_area_blocks_other_city():
    message = validate_public_delivery_area(
        enabled=True,
        allowed_cities=[{"cidade": "Limoeiro do Norte", "uf": "CE"}],
        allowed_neighborhoods=[],
        city="Magé",
        state="RJ",
        neighborhood="Centro",
    )
    assert message
    assert "fora da área de entrega" in message


def test_delivery_area_accepts_accents_and_case():
    assert validate_public_delivery_area(
        enabled=True,
        allowed_cities=[{"cidade": "São Paulo", "uf": "SP"}],
        allowed_neighborhoods=["Vila Olímpia"],
        city="sao paulo",
        state="sp",
        neighborhood="Vila Olimpia",
    ) is None


def test_enabled_empty_area_fails_closed():
    message = validate_public_delivery_area(
        enabled=True,
        allowed_cities=[],
        allowed_neighborhoods=[],
        city="Fortaleza",
        state="CE",
        neighborhood="Centro",
    )
    assert message
    assert "ainda não foi configurada" in message

def test_area_rule_only_applies_to_delivery_not_pickup_or_dine_in():
    from app.services.delivery_area_policy import validate_service_area_for_order

    for order_type in ("Retirada", "Consumo no Local"):
        assert validate_service_area_for_order(
            order_type=order_type,
            enabled=True,
            allowed_cities=[{"cidade": "Fortaleza", "uf": "CE"}],
            allowed_neighborhoods=["Centro"],
            city="Magé",
            state="RJ",
            neighborhood="Outro",
        ) is None

    assert validate_service_area_for_order(
        order_type="Delivery",
        enabled=True,
        allowed_cities=[{"cidade": "Fortaleza", "uf": "CE"}],
        allowed_neighborhoods=["Centro"],
        city="Magé",
        state="RJ",
        neighborhood="Outro",
    ) is not None
