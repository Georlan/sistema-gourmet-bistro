import datetime
from types import SimpleNamespace

from app.application.orders.commands import DeliveryAddressInput
from app.services.delivery_area_policy import (
    OUTSIDE_DELIVERY_AREA_MESSAGE,
    delivery_area_unavailability,
    normalize_delivery_area_policy,
)
from app.services.order_attribution import build_order_attribution


def _address(**changes):
    values = dict(
        street="Rua A",
        number="10",
        neighborhood="Centro",
        city="Limoeiro do Norte",
        state="CE",
        postal_code="62930000",
    )
    values.update(changes)
    return DeliveryAddressInput(**values)


def test_delivery_area_is_opt_in_and_only_blocks_outside_configured_area():
    assert delivery_area_unavailability(None, _address(city="Magé", state="RJ")) is None
    policy = normalize_delivery_area_policy({
        "enabled": True,
        "city": "Limoeiro do Norte",
        "state": "ce",
        "neighborhoods": ["Centro", "Bairro de Fátima"],
    })
    assert delivery_area_unavailability(policy, _address()) is None
    assert delivery_area_unavailability(policy, _address(neighborhood="Bairro de Fatima")) is None
    assert delivery_area_unavailability(policy, _address(city="Magé", state="RJ")) == OUTSIDE_DELIVERY_AREA_MESSAGE
    assert delivery_area_unavailability(policy, _address(neighborhood="Zona Rural")) == OUTSIDE_DELIVERY_AREA_MESSAGE


def test_delivery_area_without_neighborhood_list_accepts_entire_city():
    policy = {"enabled": True, "city": "Limoeiro do Norte", "state": "CE", "neighborhoods": []}
    assert delivery_area_unavailability(policy, _address(neighborhood="Zona Rural")) is None


def test_attribution_detects_instagram_without_persisting_ip_or_raw_user_agent():
    request = SimpleNamespace(headers={
        "user-agent": "Mozilla/5.0 Instagram 449.0.0.52.84 Android",
        "referer": "https://l.instagram.com/",
        "x-forwarded-for": "45.186.157.201",
    })
    result = build_order_attribution({
        "utm_source": "story",
        "utm_campaign": "almoco_domingo",
        "entry_path": "/quentinha-caseira?utm_source=story",
        "first_seen_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, request)
    assert result["platform"] == "instagram"
    assert result["source"] == "story"
    assert result["referrer_host"] == "l.instagram.com"
    assert "45.186.157.201" not in str(result)
    assert "user-agent" not in result
