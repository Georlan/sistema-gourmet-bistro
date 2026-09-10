from app.restaurant_profile_models import RestauranteOperationProfile


def test_operation_profile_is_tenant_local_and_defaults_to_generic():
    assert RestauranteOperationProfile.__tablename__ == "restaurante_operation_profiles"
    assert RestauranteOperationProfile.restaurante_id.primary_key is True
    assert RestauranteOperationProfile.profile_key.default.arg == "generic"
    assert RestauranteOperationProfile.profile_key.server_default.arg == "generic"
    assert RestauranteOperationProfile.profile_key.nullable is False


def test_operation_profile_does_not_encode_restaurant_types_in_schema():
    profile_type = RestauranteOperationProfile.profile_key.type
    assert profile_type.length == 64
