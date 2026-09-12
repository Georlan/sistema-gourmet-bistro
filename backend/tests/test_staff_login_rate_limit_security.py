from app.services import staff_login_rate_limit as limiter


def _buckets(identifier: str, client_ip: str):
    return {
        scope: (key_hash, max_failures)
        for scope, key_hash, max_failures in limiter._bucket_specs(
            42,
            identifier,
            client_ip,
        )
    }


def test_account_bucket_survives_rotating_forwarded_ip():
    """Changing the apparent source must not reset every brute-force bucket."""
    first = _buckets("Staff@Example.COM", "198.51.100.10")
    second = _buckets("staff@example.com", "203.0.113.77")

    assert first[limiter._SCOPE_IP][0] != second[limiter._SCOPE_IP][0]
    assert first[limiter._SCOPE_ACCOUNT][0] == second[limiter._SCOPE_ACCOUNT][0]


def test_account_bucket_is_more_permissive_than_single_source_bucket():
    """Distributed protection must not create a stricter global lockout."""
    buckets = _buckets("staff@example.com", "198.51.100.10")

    assert buckets[limiter._SCOPE_IP][1] == limiter._MAX_FAILURES_IP
    assert buckets[limiter._SCOPE_ACCOUNT][1] == limiter._MAX_FAILURES_ACCOUNT
    assert limiter._MAX_FAILURES_ACCOUNT >= limiter._MAX_FAILURES_IP
