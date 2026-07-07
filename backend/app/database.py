from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi import Request
import os
from .config import settings

# Default engine and SessionLocal compatibility exports (for tests and scripts)
engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30.0})
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
        
        # Apply performance WAL pragmas for SQLite
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
        
        # Check and add modo_exclusivo_salao if missing (migration)
        from sqlalchemy import text
        with tenant_engine.connect() as conn:
            res = conn.execute(text("PRAGMA table_info(configuracoes_restaurante)"))
            columns = [row[1] for row in res.fetchall()]
            if "modo_exclusivo_salao" not in columns:
                conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN modo_exclusivo_salao BOOLEAN DEFAULT 1"))
                conn.commit()
        
        engines[tenant_id] = tenant_engine
        sessionmakers[tenant_id] = sessionmaker(autocommit=False, autoflush=False, bind=tenant_engine)

    session_factory = sessionmakers[tenant_id]
    db = session_factory()
    try:
        yield db
    finally:
        db.close()

