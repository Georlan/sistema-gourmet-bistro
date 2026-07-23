import sentry_sdk
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from .config import settings
from .database import engine, Base, current_restaurante_id
from .routes import auth, products, tables, orders, websocket, caixa, optimization, estoque, cardapio, super_admin, ai, print_agents, cardapio_digital, relatorios

import os
# Inicializa o Sentry antes de qualquer coisa no app (desativado em testes e PII desativado por padrão)
if os.getenv("ENVIRONMENT") != "test" and settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        send_default_pii=os.getenv("SENTRY_SEND_PII", "False").lower() == "true",
        traces_sample_rate=0.2,
    )



# Automatically create database tables and run migrations on startup (DISABLED: Controlled via Alembic)
# try:
#     Base.metadata.create_all(bind=engine)
#     from sqlalchemy import text, inspect
# 
#     # 1. Seed default Restaurante (ID=1) and dynamically add restaurante_id column to business tables
#     with engine.connect() as conn:
#         conn.execute(text("INSERT INTO restaurantes (id, nome, plano) VALUES (1, 'Kôma Bistrô', 'pocket') ON CONFLICT (id) DO NOTHING"))
#         conn.commit()
#         
#         tables_to_migrate = ['usuarios', 'mesas', 'categorias', 'produtos', 'comandas', 'pagamentos', 'configuracoes_restaurante', 'insumos']
#         insp = inspect(engine)
#         for table in tables_to_migrate:
#             try:
#                 cols = {c["name"] for c in insp.get_columns(table)}
#                 if "restaurante_id" not in cols:
#                     conn.execute(text(f"ALTER TABLE {table} ADD COLUMN restaurante_id INTEGER DEFAULT 1"))
#                     conn.commit()
#                     print(f"[MIGRATION] Added restaurante_id column to table: {table}")
#             except Exception as e:
#                 print(f"[MIGRATION ERROR] Failed to add restaurante_id to table {table}: {e}")
# 
#     # 2. Existing migrations for both local and production databases
#     with engine.connect() as conn:
#         insp = inspect(engine)
#         
#         # configuracoes_restaurante
#         config_cols = {c["name"] for c in insp.get_columns("configuracoes_restaurante")}
#         sqlite_migrations = [
#             ("modo_exclusivo_salao", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_delivery", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_editar", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_taxas", "BOOLEAN DEFAULT FALSE"),
#             ("perm_garcom_cancelar", "BOOLEAN DEFAULT FALSE"),
#             ("perm_garcom_status", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_abrir_vazia", "BOOLEAN DEFAULT FALSE"),
#             ("perm_garcom_print", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_fechar", "BOOLEAN DEFAULT FALSE"),
#             ("perm_garcom_desconto", "BOOLEAN DEFAULT FALSE"),
#             ("perm_garcom_acrescimo", "BOOLEAN DEFAULT FALSE"),
#             ("perm_garcom_pessoas", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_transferir_mesa", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_transferir_item", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_chamar", "BOOLEAN DEFAULT TRUE"),
#             ("perm_garcom_ociosas", "BOOLEAN DEFAULT TRUE"),
#         ]
#         for col, col_def in sqlite_migrations:
#             if col not in config_cols:
#                 conn.execute(text(f"ALTER TABLE configuracoes_restaurante ADD COLUMN {col} {col_def}"))
#         conn.commit()
# 
#         # pagamentos
#         pag_cols = {c["name"] for c in insp.get_columns("pagamentos")}
#         pag_migrations = [
#             ("status", "VARCHAR DEFAULT 'aprovado'"),
#             ("idempotency_key", "VARCHAR"),
#             ("cpf_cliente", "VARCHAR"),
#             ("nome_cliente", "VARCHAR"),
#             ("nsu_cartao", "VARCHAR"),
#             ("chave_nfe_emitida", "VARCHAR"),
#         ]
#         for col, col_def in pag_migrations:
#             if col not in pag_cols:
#                 conn.execute(text(f"ALTER TABLE pagamentos ADD COLUMN {col} {col_def}"))
#         conn.commit()
# 
#         # comandas — new Kanban flow fields
#         cmd_cols = {c["name"] for c in insp.get_columns("comandas")}
#         cmd_migrations = [
#             ("status_comanda", "VARCHAR"),  # null | aguardando_pagamento
#             ("mesa_origem_id", "INTEGER DEFAULT NULL"),
#         ]
#         for col, col_def in cmd_migrations:
#             if col not in cmd_cols:
#                 conn.execute(text(f"ALTER TABLE comandas ADD COLUMN {col} {col_def}"))
#         conn.commit()
# 
#         # itens — new index/multi-tenancy fields
#         item_cols = {c["name"] for c in insp.get_columns("itens")}
#         item_migrations = [
#             ("restaurante_id", "INTEGER DEFAULT 1"),
#         ]
#         for col, col_def in item_migrations:
#             if col not in item_cols:
#                 conn.execute(text(f"ALTER TABLE itens ADD COLUMN {col} {col_def}"))
#         conn.commit()
# except Exception as e:
#     print(f"Error running database migrations: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_migrations_on_startup()
    from .database import validate_postgres_runtime_role
    validate_postgres_runtime_role()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="Backend API local para o App de Garçons e Caixas do Bistrô",
    lifespan=lifespan
)

# ─── STARTUP: Auto-run Alembic migrations ─────────────────────────────────────
async def run_migrations_on_startup():
    """
    Executa migrações Alembic automaticamente no startup do servidor.

    Lida com dois cenários:
    1. Banco pré-Alembic (tabela alembic_version não existe) → stamp inicial + upgrade
    2. Estado quebrado (stamp aplicado mas migration não rodou) → reset stamp + upgrade
       Detectado verificando se a coluna 'mesa_origem_id' existe fisicamente na tabela
       'comandas'. Se não existir, a migration de emergência nunca rodou.
    """
    migration_engine = None
    try:
        import os
        import sqlalchemy as sa
        from sqlalchemy import inspect as sa_inspect
        from alembic.config import Config
        from alembic import command

        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        alembic_cfg_path = os.path.join(backend_dir, "alembic.ini")
        alembic_cfg = Config(alembic_cfg_path)
        alembic_cfg.set_main_option("sqlalchemy.url", settings.MIGRATION_DATABASE_URL)

        print("[ALEMBIC] Verificando estado do banco de dados...")

        migration_engine = sa.create_engine(settings.MIGRATION_DATABASE_URL)
        with migration_engine.connect() as conn:
            insp = sa_inspect(conn)
            has_alembic_version = insp.has_table("alembic_version")

            # Verifica se a coluna crítica foi realmente criada (prova física da migration)
            has_mesa_origem_id = False
            has_itens_restaurante_id = False
            if insp.has_table("comandas"):
                cmd_cols = {c["name"] for c in insp.get_columns("comandas")}
                has_mesa_origem_id = "mesa_origem_id" in cmd_cols
            if insp.has_table("itens"):
                item_cols = {c["name"] for c in insp.get_columns("itens")}
                has_itens_restaurante_id = "restaurante_id" in item_cols

            migration_ran = has_mesa_origem_id and has_itens_restaurante_id

        if not has_alembic_version:
            # Banco criado manualmente antes do Alembic existir
            print("[ALEMBIC] Banco pré-Alembic detectado. Aplicando stamp em dcbca6699d38...")
            command.stamp(alembic_cfg, "dcbca6699d38")

        elif not migration_ran:
            # Estado quebrado: alembic_version existe mas a migration de emergência
            # nunca rodou (stamp foi aplicado durante um deploy com erro anterior).
            # Reseta o stamp para dcbca6699d38 para forçar re-execução da emergência.
            print("[ALEMBIC] ⚠️  Estado inconsistente detectado!")
            print("[ALEMBIC]    Colunas críticas ausentes mas alembic_version já existe.")
            print("[ALEMBIC]    Resetando stamp para dcbca6699d38 e re-aplicando migration...")
            with migration_engine.connect() as conn:
                conn.execute(sa.text(
                    "UPDATE alembic_version SET version_num = 'dcbca6699d38'"
                ))
                conn.commit()

        print("[ALEMBIC] Rodando upgrade heads...")
        command.upgrade(alembic_cfg, "heads")
        print("[ALEMBIC] ✅ Migrações concluídas com sucesso.")

        # Executar DDL de emergência caso a coluna mesa_transferida_de não exista na tabela comandas
        with migration_engine.connect() as conn:
            insp = sa_inspect(conn)
            if insp.has_table("comandas"):
                columns = {c["name"] for c in insp.get_columns("comandas")}
                if "mesa_transferida_de" not in columns:
                    print("[DATABASE] Adicionando coluna 'mesa_transferida_de' na tabela comandas...")
                    conn.execute(sa.text("ALTER TABLE comandas ADD COLUMN mesa_transferida_de INTEGER;"))
                    conn.commit()
    except Exception as e:
        print(f"[ALEMBIC] ❌ Erro ao rodar migrações automáticas: {e}")
        import traceback
        traceback.print_exc()
        if os.getenv("ENVIRONMENT") != "test":
            raise RuntimeError(f"Falha crítica na migração de inicialização do banco: {e}") from e
    finally:
        if migration_engine is not None:
            migration_engine.dispose()

ALLOWED_ORIGINS = [
    "https://sistema-gourmet-bistro.pages.dev",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"https://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    origin = request.headers.get("Origin", "")
    cors_origin = origin if origin else "*"
    print(f"[GLOBAL UNHANDLED ERROR] {request.method} {request.url.path}:\n{traceback.format_exc()}")
    
    is_dev = os.getenv("ENVIRONMENT") == "development"
    body = {"detail": "Erro interno do servidor."}
    if is_dev:
        body["error"] = str(exc)

    return JSONResponse(
        status_code=500,
        content=body,
        headers={
            "Access-Control-Allow-Origin": cors_origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tenant-ID, Accept, Origin",
        }
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    origin = request.headers.get("Origin", "")
    cors_origin = origin if origin else "*"
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={
            "Access-Control-Allow-Origin": cors_origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tenant-ID, Accept, Origin",
        }
    )

@app.middleware("http")
async def add_sentry_context_and_tenant(request: Request, call_next):
    from fastapi.responses import JSONResponse
    origin = request.headers.get("Origin", "*")
    cors_headers = {
        "Access-Control-Allow-Origin": origin if origin != "*" else "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tenant-ID, Accept, Origin",
    }
    if request.method == "OPTIONS":
        return JSONResponse(status_code=200, content={"status": "ok"}, headers=cors_headers)
    tenant_id = request.headers.get("X-Tenant-ID", "default")
    restaurante_id: int | None = None
    
    auth_header = request.headers.get("Authorization")
    if auth_header:
        if auth_header.startswith("Bearer "):
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
                        headers=cors_headers
                    )

                try:
                    parsed_rid = int(rid)
                except (TypeError, ValueError):
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "Identificação do restaurante inválida ou ausente no token."},
                        headers=cors_headers
                    )

                if parsed_rid < 0 or (parsed_rid == 0 and role != "superadmin"):
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "Identificação do restaurante inválida ou ausente no token."},
                        headers=cors_headers
                    )

                restaurante_id = parsed_rid
            except jwt.PyJWTError as e:
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=401,
                    content={"detail": f"Token de autenticação inválido ou expirado: {str(e)}"},
                    headers=cors_headers
                )
            except Exception:
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Falha na validação do token de autenticação."},
                    headers=cors_headers
                )
        else:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Cabeçalho de autorização mal-formatado. Formato esperado: 'Bearer <token>'."},
                headers=cors_headers
            )

    sentry_sdk.set_tag("tenant_id", tenant_id)
    sentry_sdk.set_tag("restaurante_id", str(restaurante_id) if restaurante_id is not None else "")

    # Define a variável de contexto do tenant de forma segura para esta requisição
    tenant_context = current_restaurante_id.set(restaurante_id)
    try:
        response = await call_next(request)
        if origin and origin != "*":
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Tenant-ID, Accept, Origin"
        return response
    finally:
        # Garante a limpeza do contexto após o término da requisição
        current_restaurante_id.reset(tenant_context)

# Register routers
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(tables.router)
app.include_router(orders.router)
app.include_router(websocket.router)
app.include_router(caixa.router)
app.include_router(optimization.router)
app.include_router(estoque.router)
app.include_router(cardapio.router)
app.include_router(print_agents.router)
app.include_router(cardapio_digital.router)
app.include_router(relatorios.router)
app.include_router(super_admin.router, prefix="/api")
app.include_router(ai.router, prefix="/api")


@app.get("/")
def read_root():
    return {
        "status": "online",
        "app": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "docs": "/docs",
    }


# Rota temporária para testar se o Sentry do Backend está capturando erros (desativada em produção)
@app.get("/sentry-debug")
def trigger_backend_error():
    if os.getenv("ENVIRONMENT") == "production":
        raise HTTPException(status_code=404, detail="Endpoint indisponível.")
    division_by_zero = 1 / 0
    return {"status": division_by_zero}


@app.get("/health")
def health_check():
    # 1. Testar conexão com o banco de dados
    db_status = "healthy"
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        is_dev = os.getenv("ENVIRONMENT") == "development"
        db_status = f"unhealthy: {e}" if is_dev else "unhealthy"

    # 2. Contar arquivos na fila de impressão
    print_jobs_count = 0
    try:
        import os
        if os.path.exists(settings.PRINT_JOBS_DIR):
            print_jobs_count = len([f for f in os.listdir(settings.PRINT_JOBS_DIR) if os.path.isfile(os.path.join(settings.PRINT_JOBS_DIR, f))])
    except Exception:
        pass

    # 3. Contar conexões ativas no WebSocket
    ws_connections_count = 0
    try:
        from .websocket_manager import manager
        ws_connections_count = sum(len(conns) for conns in manager.active_connections.values())
    except Exception:
        pass

    return {
        "status": "ok",
        "version": settings.PROJECT_VERSION,
        "database": db_status,
        "print_queue": {
            "jobs_count": print_jobs_count,
            "directory": settings.PRINT_JOBS_DIR
        },
        "websocket": {
            "active_connections": ws_connections_count
        }
    }
