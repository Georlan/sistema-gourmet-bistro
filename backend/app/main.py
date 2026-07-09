import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import engine, Base
from .routes import auth, products, tables, orders, websocket, caixa, optimization

# Inicializa o Sentry antes de qualquer coisa no app
sentry_sdk.init(
    dsn=settings.SENTRY_DSN,
    send_default_pii=True,  # Envia dados adicionais como IP para ajudar no diagnóstico
    traces_sample_rate=1.0,  # Captura transações para monitorar lentidão
)

# Automatically create database tables and run migrations on startup
try:
    Base.metadata.create_all(bind=engine)
    from sqlalchemy import text, inspect

    # 1. Seed default Restaurante (ID=1) and dynamically add restaurante_id column to business tables
    with engine.connect() as conn:
        conn.execute(text("INSERT INTO restaurantes (id, nome, plano) VALUES (1, 'Kôma Bistrô', 'pocket') ON CONFLICT (id) DO NOTHING"))
        conn.commit()
        
        tables_to_migrate = ['usuarios', 'mesas', 'categorias', 'produtos', 'comandas', 'pagamentos', 'configuracoes_restaurante']
        insp = inspect(engine)
        for table in tables_to_migrate:
            try:
                cols = {c["name"] for c in insp.get_columns(table)}
                if "restaurante_id" not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN restaurante_id INTEGER DEFAULT 1"))
                    conn.commit()
                    print(f"[MIGRATION] Added restaurante_id column to table: {table}")
            except Exception as e:
                print(f"[MIGRATION ERROR] Failed to add restaurante_id to table {table}: {e}")

    # 2. Existing SQLite-specific columns migrations for local environment
    if settings.DATABASE_URL.startswith("sqlite"):
        with engine.connect() as conn:
            insp = inspect(engine)
            
            # configuracoes_restaurante
            config_cols = {c["name"] for c in insp.get_columns("configuracoes_restaurante")}
            sqlite_migrations = [
                ("modo_exclusivo_salao", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_delivery", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_editar", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_taxas", "BOOLEAN DEFAULT 0"),
                ("perm_garcom_cancelar", "BOOLEAN DEFAULT 0"),
                ("perm_garcom_status", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_abrir_vazia", "BOOLEAN DEFAULT 0"),
                ("perm_garcom_print", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_fechar", "BOOLEAN DEFAULT 0"),
                ("perm_garcom_desconto", "BOOLEAN DEFAULT 0"),
                ("perm_garcom_acrescimo", "BOOLEAN DEFAULT 0"),
                ("perm_garcom_pessoas", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_transferir_mesa", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_transferir_item", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_chamar", "BOOLEAN DEFAULT 1"),
                ("perm_garcom_ociosas", "BOOLEAN DEFAULT 1"),
            ]
            for col, col_def in sqlite_migrations:
                if col not in config_cols:
                    conn.execute(text(f"ALTER TABLE configuracoes_restaurante ADD COLUMN {col} {col_def}"))
            conn.commit()

            # pagamentos
            pag_cols = {c["name"] for c in insp.get_columns("pagamentos")}
            pag_migrations = [
                ("status", "VARCHAR DEFAULT 'aprovado'"),
                ("idempotency_key", "VARCHAR"),
                ("cpf_cliente", "VARCHAR"),
                ("nome_cliente", "VARCHAR"),
                ("nsu_cartao", "VARCHAR"),
                ("chave_nfe_emitida", "VARCHAR"),
            ]
            for col, col_def in pag_migrations:
                if col not in pag_cols:
                    conn.execute(text(f"ALTER TABLE pagamentos ADD COLUMN {col} {col_def}"))
            conn.commit()
except Exception as e:
    print(f"Error running database migrations: {e}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="Backend API local para o App de Garçons e Caixas do Bistrô",
)

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
async def add_sentry_context(request: Request, call_next):
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
        
    return await call_next(request)

# Register routers
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(tables.router)
app.include_router(orders.router)
app.include_router(websocket.router)
app.include_router(caixa.router)
app.include_router(optimization.router)


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
