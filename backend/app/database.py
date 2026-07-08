from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi import Request
import os
from .config import settings

# AJUSTADO: connect_args agora é condicional para não travar no PostgreSQL (Supabase)
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30.0}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@event.listens_for(engine, "connect")
def set_default_sqlite_pragma(dbapi_connection, connection_record):
    if settings.DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

# Pre-populate registry cache
engines = {"default": engine}
sessionmakers = {"default": SessionLocal}

Base = declarative_base()

def get_tenant_db_url(tenant_id: str) -> str:
    """Sanitizes tenant ID and returns the SQLite file URL path."""
    safe_tenant = "".join(c for c in tenant_id if c.isalnum() or c in ("-", "_"))
    return f"sqlite:///./tenants/{safe_tenant}.db"

# DB Session dependency generator supporting dynamic tenant databases
def get_db(request: Request = None):
    tenant_id = "default"
    if request:
        tenant_id = request.headers.get("X-Tenant-ID", "default")

    if tenant_id not in engines:
        db_url = settings.DATABASE_URL
        if tenant_id != "default":
            # Ensure tenants storage directory exists
            os.makedirs("./tenants", exist_ok=True)
            db_url = get_tenant_db_url(tenant_id)
        
        connect_args = {}
        if db_url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            connect_args["timeout"] = 30.0
            
        tenant_engine = create_engine(db_url, connect_args=connect_args)
        
        # Apply performance WAL pragmas for SQLite only
        @event.listens_for(tenant_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            if db_url.startswith("sqlite"):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
                
        # Automatically initialize tables on new tenant database creation
        Base.metadata.create_all(bind=tenant_engine)
        
        # Inline column migrations — SQLite only (PostgreSQL gets full schema via create_all)
        if db_url.startswith("sqlite"):
            from sqlalchemy import text, inspect
            insp = inspect(tenant_engine)
            with tenant_engine.connect() as conn:
                # configuracoes_restaurante migrations
                try:
                    existing_cols = {c["name"] for c in insp.get_columns("configuracoes_restaurante")}
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
                        if col not in existing_cols:
                            conn.execute(text(f"ALTER TABLE configuracoes_restaurante ADD COLUMN {col} {col_def}"))
                    conn.commit()
                except Exception:
                    pass  # Table may not exist yet — create_all handles it

                # pagamentos migrations
                try:
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
                except Exception:
                    pass  # Table may not exist yet
        
        engines[tenant_id] = tenant_engine
        sessionmakers[tenant_id] = sessionmaker(autocommit=False, autoflush=False, bind=tenant_engine)

    session_factory = sessionmakers[tenant_id]
    db = session_factory()
    try:
        yield db
    finally:
        db.close()