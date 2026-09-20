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
    assert "SessionLocal()" in endpoint
    assert "resolve_public_tracking(db, token)" in endpoint
    assert "db.close()" in endpoint

    # A sessão curta precisa ser fechada antes de o gerador SSE ser criado.
    assert endpoint.index("SessionLocal()") < endpoint.index("db.close()")
    assert endpoint.index("db.close()") < endpoint.index("async def event_generator()")
