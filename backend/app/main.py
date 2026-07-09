import sentry_sdk
from fastapi import FastAPI
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

# Automatically create sqlite database tables on start if they do not exist
try:
    Base.metadata.create_all(bind=engine)
    from sqlalchemy import text

    if settings.DATABASE_URL.startswith("sqlite"):
        with engine.connect() as conn:
            res = conn.execute(text("PRAGMA table_info(configuracoes_restaurante)"))
            columns = [row[1] for row in res.fetchall()]
            if "modo_exclusivo_salao" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN modo_exclusivo_salao BOOLEAN DEFAULT 1"))
            if "perm_garcom_delivery" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_delivery BOOLEAN DEFAULT 1"))
            if "perm_garcom_editar" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_editar BOOLEAN DEFAULT 1"))
            if "perm_garcom_taxas" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_taxas BOOLEAN DEFAULT 0"))
            if "perm_garcom_cancelar" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_cancelar BOOLEAN DEFAULT 0"))
            if "perm_garcom_status" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_status BOOLEAN DEFAULT 1"))
            if "perm_garcom_abrir_vazia" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_abrir_vazia BOOLEAN DEFAULT 0"))
            if "perm_garcom_print" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_print BOOLEAN DEFAULT 1"))
            if "perm_garcom_fechar" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_fechar BOOLEAN DEFAULT 0"))
            if "perm_garcom_desconto" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_desconto BOOLEAN DEFAULT 0"))
            if "perm_garcom_acrescimo" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_acrescimo BOOLEAN DEFAULT 0"))
            if "perm_garcom_pessoas" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_pessoas BOOLEAN DEFAULT 1"))
            if "perm_garcom_transferir_mesa" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_transferir_mesa BOOLEAN DEFAULT 1"))
            if "perm_garcom_transferir_item" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_transferir_item BOOLEAN DEFAULT 1"))
            if "perm_garcom_chamar" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_chamar BOOLEAN DEFAULT 1"))
            if "perm_garcom_ociosas" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN perm_garcom_ociosas BOOLEAN DEFAULT 1"))
            conn.commit()

            # Migrations for pagamentos table
            res_pag = conn.execute(text("PRAGMA table_info(pagamentos)"))
            columns_pag = [row[1] for row in res_pag.fetchall()]
            if "status" not in columns_pag:
                conn.execute(text("ALTER TABLE pagamentos ADD COLUMN status VARCHAR DEFAULT 'aprovado'"))
            if "idempotency_key" not in columns_pag:
                conn.execute(text("ALTER TABLE pagamentos ADD COLUMN idempotency_key VARCHAR"))
            if "cpf_cliente" not in columns_pag:
                conn.execute(text("ALTER TABLE pagamentos ADD COLUMN cpf_cliente VARCHAR"))
            if "nome_cliente" not in columns_pag:
                conn.execute(text("ALTER TABLE pagamentos ADD COLUMN nome_cliente VARCHAR"))
            if "nsu_cartao" not in columns_pag:
                conn.execute(text("ALTER TABLE pagamentos ADD COLUMN nsu_cartao VARCHAR"))
            if "chave_nfe_emitida" not in columns_pag:
                conn.execute(text("ALTER TABLE pagamentos ADD COLUMN chave_nfe_emitida VARCHAR"))
            conn.commit()
except Exception as e:
    print(f"Error initializing SQLite Database: {e}")

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
