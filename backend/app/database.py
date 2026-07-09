from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base, Session, with_loader_criteria
from contextvars import ContextVar
from fastapi import Request
import os
from .config import settings

# AJUSTADO: connect_args agora é condicional para não travar no PostgreSQL (Supabase)
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30.0}

Base = declarative_base()

# ContextVar to track the logical restaurante_id for the current request context
current_restaurante_id: ContextVar[int] = ContextVar("current_restaurante_id", default=1)

class TenantSession(Session):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.restaurante_id = 1

@event.listens_for(Session, "do_orm_execute")
def _add_tenant_id_filtering_criteria(execute_state):
    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
    ):
        context_override = current_restaurante_id.get()
        if context_override is not None:
            session = execute_state.session
            tenant_id = getattr(session, "restaurante_id", 1)
            for mapper in Base.registry.mappers:
                cls = mapper.class_
                if hasattr(cls, "restaurante_id"):
                    execute_state.statement = execute_state.statement.options(
                        with_loader_criteria(
                            cls,
                            lambda target_cls: target_cls.restaurante_id == tenant_id,
                            track_closure_variables=False
                        )
                    )


# Connection pool tuning for PostgreSQL (Supabase/Railway)
# SQLite uses StaticPool internally and doesn't accept these args
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=10,          # base pool: up to 10 persistent connections
        max_overflow=20,       # allow up to 20 extra when busy (total: 30)
        pool_timeout=15,       # raise after 15s instead of default 30s (fail fast)
        pool_recycle=1800,     # recycle connections every 30 min (avoids stale handles)
        pool_pre_ping=True,    # test connection health before handing it to a request
        connect_args=connect_args,
    )
SessionLocal = sessionmaker(class_=TenantSession, autocommit=False, autoflush=False, bind=engine)


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

from sqlalchemy import text
@event.listens_for(Base.metadata, "after_create")
def insert_default_restaurant(target, connection, **kw):
    connection.execute(
        text("INSERT INTO restaurantes (id, nome, plano) VALUES (1, 'Kôma Bistrô', 'pocket') ON CONFLICT (id) DO NOTHING")
    )

# DB Session dependency generator supporting dynamic tenant databases
def get_db(request: Request = None):
    tenant_id = "default"
    restaurante_id = 1
    
    if request:
        tenant_id = request.headers.get("X-Tenant-ID", "default")
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            try:
                import jwt
                from .config import settings
                payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
                restaurante_id = int(payload.get("restaurante_id", 1))
            except Exception:
                pass

    token_var = current_restaurante_id.set(restaurante_id)

    try:
        import sentry_sdk
        sentry_sdk.set_tag("tenant_id", tenant_id)
        sentry_sdk.set_tag("restaurante_id", str(restaurante_id))
    except Exception:
        pass

    db = SessionLocal()
    db.restaurante_id = restaurante_id
    try:
        yield db
    finally:
        db.close()