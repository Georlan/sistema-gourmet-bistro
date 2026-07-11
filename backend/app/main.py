import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import engine, Base, current_restaurante_id
from .routes import auth, products, tables, orders, websocket, caixa, optimization, estoque

# Inicializa o Sentry antes de qualquer coisa no app
sentry_sdk.init(
    dsn=settings.SENTRY_DSN,
    send_default_pii=True,  # Envia dados adicionais como IP para ajudar no diagnóstico
    traces_sample_rate=1.0,  # Captura transações para monitorar lentidão
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

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="Backend API local para o App de Garçons e Caixas do Bistrô",
)

# ─── STARTUP: Auto-run Alembic migrations ─────────────────────────────────────
@app.on_event("startup")
async def run_migrations_on_startup():
    """
    Executa 'alembic upgrade head' automaticamente ao subir o servidor.
    
    Lógica especial para o banco de produção (Railway):
    - Se a tabela alembic_version NÃO existir, significa que o banco foi criado
      manualmente antes do Alembic. Nesse caso, fazemos o 'stamp' direto na
      revision de emergência (que só adiciona colunas faltantes via IF NOT EXISTS).
    - Se a tabela alembic_version JÁ existir, rodamos normalmente 'upgrade head'.
    """
    try:
        import os
        from sqlalchemy import text, inspect
        from alembic.config import Config
        from alembic import command

        # Resolve o caminho do alembic.ini relativo ao diretório do backend
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        alembic_cfg_path = os.path.join(backend_dir, "alembic.ini")

        alembic_cfg = Config(alembic_cfg_path)
        # Override da URL para garantir que usa DATABASE_URL do ambiente
        alembic_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

        print("[ALEMBIC] Verificando estado do banco de dados...")

        # Verifica se a tabela alembic_version já existe
        with engine.connect() as conn:
            insp = inspect(conn)
            has_alembic_version = insp.has_table("alembic_version")

        if not has_alembic_version:
            # Banco criado manualmente (pré-Alembic). Fazemos stamp na revision
            # INICIAL (dcbca6699d38) — isso diz ao Alembic "as tabelas base já
            # existem, não tente recriá-las". O upgrade head a seguir roda apenas
            # a migration de emergência (8f3a2d1c9e7b) que adiciona colunas faltantes
            # via ADD COLUMN IF NOT EXISTS, que é 100% segura e idempotente.
            print("[ALEMBIC] Tabela alembic_version não encontrada.")
            print("[ALEMBIC] Banco pré-Alembic detectado — aplicando stamp na migration inicial...")
            command.stamp(alembic_cfg, "dcbca6699d38")
            print("[ALEMBIC] Stamp aplicado em dcbca6699d38. Rodando upgrade head (emergência)...")

        command.upgrade(alembic_cfg, "head")
        print("[ALEMBIC] ✅ Migrações concluídas com sucesso.")
    except Exception as e:
        # Não derruba o servidor se a migration falhar — loga e continua
        print(f"[ALEMBIC] ⚠️ Erro ao rodar migrações automáticas: {e}")
        import traceback
        traceback.print_exc()

# CORS configuration to allow local frontend access (WiFi/Local Network)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*"
    ],  # Permits access from any device on the local network (smartphones/tablets)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_sentry_context_and_tenant(request: Request, call_next):
    tenant_id = request.headers.get("X-Tenant-ID", "default")
    restaurante_id = 1
    
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            import jwt
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            restaurante_id = int(payload.get("restaurante_id", 1))
        except Exception:
            pass

    sentry_sdk.set_tag("tenant_id", tenant_id)
    sentry_sdk.set_tag("restaurante_id", str(restaurante_id))

    # Define a variável de contexto do tenant de forma segura para esta requisição
    token_context = current_restaurante_id.set(restaurante_id)
    try:
        response = await call_next(request)
    finally:
        # Garante a limpeza do contexto após o término da requisição
        current_restaurante_id.reset(token_context)

    return response

# Register routers
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(tables.router)
app.include_router(orders.router)
app.include_router(websocket.router)
app.include_router(caixa.router)
app.include_router(optimization.router)
app.include_router(estoque.router)


@app.get("/")
def read_root():
    return {
        "status": "online",
        "app": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "docs": "/docs",
    }


# Rota temporária para testar se o Sentry do Backend está capturando erros
@app.get("/sentry-debug")
def trigger_backend_error():
    division_by_zero = 1 / 0
    return {"status": division_by_zero}
