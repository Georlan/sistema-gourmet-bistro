from pathlib import Path


def test_order_tracking_sse_releases_database_session_before_streaming():
    source = (
        Path(__file__).resolve().parents[1]
        / "app/routes/order_tracking.py"
    ).read_text(encoding="utf-8")

    endpoint = source.split(
        '@router.get("/{token}/events", summary="Stream SSE de status e chat do pedido")',
        1,
    )[1].split("return StreamingResponse", 1)[0]

    assert "db: Session = Depends(get_db)" not in endpoint
    assert "with SessionLocal() as lookup_db:" in endpoint
    assert "resolve_public_tracking(lookup_db, token)" in endpoint

    # A sessão curta precisa terminar antes de o gerador SSE ser criado.
    assert endpoint.index("with SessionLocal() as lookup_db:") < endpoint.index(
        "async def event_generator()"
    )
