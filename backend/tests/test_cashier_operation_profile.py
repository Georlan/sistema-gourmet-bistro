from app.database import SessionLocal
from app.restaurant_profile_models import RestauranteOperationProfile
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def test_cashier_configuration_exposes_superadmin_profile_without_changing_legacy_niche(char_client, char_setup):
    db = SessionLocal()
    try:
        db.add(RestauranteOperationProfile(restaurante_id=CHAR_RESTAURANT_ID, profile_key="marmitaria"))
        db.commit()
        response = char_client.get('/caixa/configuracoes', headers=char_setup['headers'])
        assert response.status_code == 200, response.text
        assert response.json()['operation_profile'] == 'marmitaria'
        assert response.json()['nicho'] != 'marmitaria'
    finally:
        db.query(RestauranteOperationProfile).filter_by(restaurante_id=CHAR_RESTAURANT_ID).delete()
        db.commit()
        db.close()


def test_cashier_configuration_defaults_to_generic_without_profile(char_client, char_setup):
    response = char_client.get('/caixa/configuracoes', headers=char_setup['headers'])
    assert response.status_code == 200, response.text
    assert response.json()['operation_profile'] == 'generic'
