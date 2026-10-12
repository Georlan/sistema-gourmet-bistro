from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.fiscal.ibge import IbgeMunicipality
from app.fiscal_models import RestaurantFiscalProfile
from app.routes import fiscal_onboarding


@pytest.mark.parametrize("provider,expected", [(None, "direct_sefaz"), ("third_party_test", "third_party_test")])
def test_editing_restaurant_data_preserves_server_provisioned_provider(monkeypatch, provider, expected):
    profile = RestaurantFiscalProfile(id=100, restaurante_id=8, provider=provider, enabled=True)
    monkeypatch.setattr(fiscal_onboarding, "require_tenant_id", lambda: 8)
    monkeypatch.setattr(fiscal_onboarding, "_profile_for_tenant", lambda *args, **kwargs: profile)
    monkeypatch.setattr(fiscal_onboarding, "get_ibge_municipality", lambda code: IbgeMunicipality("2304400", "Fortaleza", "CE"))
    payload = fiscal_onboarding.FiscalProfileUpdate(
        cnpj="11222333000181", inscricao_estadual="060000015", razao_social="Restaurante Teste",
        crt="1", cnae_principal="5611201", cep="60000000", logradouro="Rua Teste",
        numero="10", bairro="Centro", municipio_codigo_ibge="2304400", uf="CE",
    )
    db = Mock()
    result = fiscal_onboarding.update_fiscal_profile(payload, db, SimpleNamespace(cargo="admin", role="admin"))
    assert profile.provider == expected
    assert result["provider"] == expected
    assert not profile.enabled
    db.commit.assert_called_once()


def test_browser_cannot_select_arbitrary_provider_through_profile_form():
    # Configuring an integration is a separate server-controlled responsibility.
    assert "provider" not in fiscal_onboarding.FiscalProfileUpdate.model_fields
