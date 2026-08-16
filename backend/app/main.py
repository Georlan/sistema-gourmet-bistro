import os
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .database import Base, current_restaurante_id, engine
from .routes import (
    ai,
    atendimento_printing,
    atendimentos,
    auth,
    caixa,
    cardapio,
    cardapio_clientes,
    cardapio_digital,
    estoque,
    optimization,
    orders,
    print_agents,
    printing,
    products,
    relatorios,
    super_admin,
    tables,
    websocket,
    whatsapp_webhook,
)


if os.getenv("ENVIRONMENT") != "test" and settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        send_default_pii=os.getenv("SENTRY_SEND_PII", "False").lower() == "true",
        traces_sample_rate=0.2,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations_override = os.getenv("RUN_MIGRATIONS_ON_STARTUP")
    running_on_railway = bool(
        os.getenv("RAILWAY_PROJECT_ID") or os.getenv("RAILWAY_ENVIRONMENT_ID")
    )
    run_migrations_here = not running_on_railway and (
        run_migrations_override.lower() == "true"
        if run_migrations_override is not None
        else settings.MIGRATION_DATABASE_URL == settings.DATABASE_URL
    )
    if run_migrations_here:
        await run_migrations_on_startup()
    else:
        print("[ALEMBIC] Migração no startup ignorada; usando o pre-deploy.", flush=True)

    from .database import validate_postgres_runtime_role

    validate_postgres_runtime_role()
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        pass
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="Backend API local para o App de Garçons e Caixas do Bistrô",
    lifespan=lifespan,
)


async def run_migrations_on_startup():
    """Executa as migrações Alembic no ambiente que não usa pre-deploy."""
    migration_engine = None
    try:
        import sqlalchemy as sa
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import inspect as sa_inspect

        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        alembic_cfg_path = os.path.join(backend_dir, "alembic.ini")
        alembic_cfg = Config(alembic_cfg_path)
        alembic_cfg.set_main_option("sqlalchemy.url", settings.MIGRATION_DATABASE_URL)

        print("[ALEMBIC] Verificando estado do banco de dados...")
        migration_engine = sa.create_engine(settings.MIGRATION_DATABASE_URL)
        with migration_engine.connect() as conn:
            insp = sa_inspect(conn)
            has_alembic_version = insp.has_table("alembic_version")
            has_mesa_origem_id = False
            has_itens_restaurante_id = False
            if insp.has_table("comandas"):
                cmd_cols = {column["name"] for column in insp.get_columns("comandas")}
                has_mesa_origem_id = "mesa_origem_id" in cmd_cols
            if insp.has_table("itens"):
                item_cols = {column["name"] for column in insp.get_columns("itens")}
                has_itens_restaurante_id = "restaurante_id" in item_cols
            migration_ran = has_mesa_origem_id and has_itens_restaurante_id

        if not has_alembic_version:
            print("[ALEMBIC] Banco pré-Alembic detectado. Aplicando stamp em dcbca6699d38...")
            command.stamp(alembic_cfg, "dcbca6699d38")
        elif not migration_ran:
            print("[ALEMBIC] Estado inconsistente detectado; restaurando o marco inicial.")
            with migration_engine.connect() as conn:
                conn.execute(sa.text("UPDATE alembic_version SET version_num = 'dcbca6699d38'"))
                conn.commit()

        print("[ALEMBIC] Rodando upgrade heads...")
        command.upgrade(alembic_cfg, "heads")
        print("[ALEMBIC] Migrações concluídas com sucesso.")

        with migration_engine.connect() as conn:
            insp = sa_inspect(conn)
            if insp.has_table("comandas"):
                columns = {column["name"] for column in insp.get_columns("comandas")}
                if "mesa_transferida_de" not in columns:
                    print("[DATABASE] Adicionando coluna 'mesa_transferida_de' na tabela comandas...")
                    conn.execute(sa.text("ALTER TABLE comandas ADD COLUMN mesa_transferida_de INTEGER;"))
                    conn.commit()
    except Exception as exc:
        print(f"[ALEMBIC] Erro ao rodar migrações automáticas: {exc}")
        import traceback

        traceback.print_exc()
        if os.getenv("ENVIRONMENT") != "test":
            raise RuntimeError(
                f"Falha crítica na migração de inicialização do banco: {exc}"
            ) from exc
    finally:
        if migration_engine is not None:
            migration_engine.dispose()


@app.middleware("http")
async def handle_unhandled_exceptions_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:
        import traceback

        print(
            f"[UNHANDLED ROUTE EXCEPTION] {request.method} {request.url.path}:\n"
            f"{traceback.format_exc()}"
        )
        is_dev = os.getenv("ENVIRONMENT", "production").lower() == "development"
        body = {"detail": "Erro interno do servidor."}
        if is_dev:
            body["error"] = str(exc)
        return JSONResponse(status_code=500, content=body)


@app.middleware("http")
async def add_sentry_context_and_tenant(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    tenant_id = request.headers.get("X-Tenant-ID", "default")
    restaurante_id: int | None = None
    auth_header = request.headers.get("Authorization")

    if auth_header:
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={
                    "detail": "Cabeçalho de autorização mal-formatado. Formato esperado: 'Bearer <token>'."
                },
            )
        try:
            parts = auth_header.split(" ")
            if len(parts) < 2:
                import jwt
                raise jwt.DecodeError("Token ausente no cabeçalho Bearer")
            token = parts[1]
            import jwt

            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            rid = payload.get("restaurante_id")
            role = payload.get("role", "")
            if isinstance(rid, bool):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Identificação do restaurante inválida ou ausente no token."},
                )
            try:
                parsed_rid = int(rid)
            except (TypeError, ValueError):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Identificação do restaurante inválida ou ausente no token."},
                )
            if parsed_rid < 0 or (parsed_rid == 0 and role != "superadmin"):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Identificação do restaurante inválida ou ausente no token."},
                )
            restaurante_id = parsed_rid
        except jwt.PyJWTError as exc:
            return JSONResponse(
                status_code=401,
                content={"detail": f"Token de autenticação inválido ou expirado: {str(exc)}"},
            )
        except Exception:
            return JSONResponse(
                status_code=401,
                content={"detail": "Falha na validação do token de autenticação."},
            )

    sentry_sdk.set_tag("tenant_id", tenant_id)
    sentry_sdk.set_tag("restaurante_id", str(restaurante_id) if restaurante_id is not None else "")

    if restaurante_id is None:
        return await call_next(request)

    tenant_context = current_restaurante_id.set(restaurante_id)
    try:
        return await call_next(request)
    finally:
        current_restaurante_id.reset(tenant_context)


@app.middleware("http")
async def add_security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["X-Frame-Options"] = "DENY"

    env = os.getenv("ENVIRONMENT", "production").lower()
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    hostname = request.url.hostname or ""
    is_localhost = hostname in ("localhost", "127.0.0.1")
    if env == "production" and is_https and not is_localhost:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback

    print(
        f"[GLOBAL UNHANDLED ERROR] {request.method} {request.url.path}:\n"
        f"{traceback.format_exc()}"
    )
    is_dev = os.getenv("ENVIRONMENT") == "development"
    body = {"detail": "Erro interno do servidor."}
    if is_dev:
        body["error"] = str(exc)
    return JSONResponse(status_code=500, content=body)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_allowed_origins(),
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "X-Koma-Customer-Token",
        "X-Tenant-ID",
        "X-Restaurante-ID",
    ],
    expose_headers=[],
)


# Os adaptadores de atendimento/impressão vêm antes das rotas legadas para
# preservar URLs do frontend com semântica transacional nova.
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(atendimentos.router)
app.include_router(atendimento_printing.router)
app.include_router(tables.router)
app.include_router(orders.router)
app.include_router(websocket.router)
app.include_router(caixa.router)
app.include_router(optimization.router)
app.include_router(estoque.router)
app.include_router(cardapio.router)
app.include_router(cardapio_clientes.router)
app.include_router(print_agents.router)
app.include_router(printing.router)
app.include_router(cardapio_digital.router)
app.include_router(relatorios.router)
app.include_router(super_admin.router, prefix="/api")
app.include_router(ai.router, prefix="/api")

if settings.KOMA_WHATSAPP_AUTOMATION_ENABLED:
    app.include_router(whatsapp_webhook.router)


@app.get("/")
def read_root():
    return {
        "status": "online",
        "app": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "docs": "/docs",
    }


@app.get("/sentry-debug")
def trigger_backend_error():
    if os.getenv("ENVIRONMENT") == "production":
        raise HTTPException(status_code=404, detail="Endpoint indisponível.")
    division_by_zero = 1 / 0
    return {"status": division_by_zero}


@app.get("/health")
def health_check():
    db_status = "healthy"
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        is_dev = os.getenv("ENVIRONMENT") == "development"
        db_status = f"unhealthy: {exc}" if is_dev else "unhealthy"

    ws_connections_count = 0
    try:
        from .websocket_manager import manager

        ws_connections_count = sum(
            len(connections) for connections in manager.active_connections.values()
        )
    except Exception:
        pass

    return {
        "status": "ok",
        "version": settings.PROJECT_VERSION,
        "database": db_status,
        "print_queue": {"backend": "postgres", "consumer": "koma-print"},
        "websocket": {"active_connections": ws_connections_count},
    }
