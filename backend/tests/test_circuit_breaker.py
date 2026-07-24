import pytest
import os
from tests.conftest import PROD_DB_INDICATORS

def test_circuit_breaker_detection():
    """Garante que a lista de indicadores de produção no Circuit Breaker cobre a URL real do Supabase."""
    prod_url = "postgresql://postgres.iiowhekvahxiepwcdidm:Minhamae123G@aws-1-us-west-2.pooler.supabase.com:6543/postgres"
    
    matched = [ind for ind in PROD_DB_INDICATORS if ind in prod_url]
    assert len(matched) >= 2
    assert "iiowhekvahxiepwcdidm" in matched
    assert "aws-1-us-west-2.pooler.supabase.com" in matched
