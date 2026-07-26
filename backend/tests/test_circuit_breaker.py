from tests.conftest import PROD_DB_INDICATORS


def test_circuit_breaker_detection():
    """Garante que o Circuit Breaker reconhece indicadores sem usar credenciais reais."""
    synthetic_prod_url = (
        "postgresql://test_user:not-a-real-password"
        "@aws-1-us-west-2.pooler.supabase.com:6543/test_db"
        "?project=iiowhekvahxiepwcdidm"
    )

    matched = [indicator for indicator in PROD_DB_INDICATORS if indicator in synthetic_prod_url]

    assert len(matched) >= 2
    assert "iiowhekvahxiepwcdidm" in matched
    assert "aws-1-us-west-2.pooler.supabase.com" in matched
