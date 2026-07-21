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
current_restaurante_id: ContextVar[int | None] = ContextVar("current_restaurante_id", default=None)

class TenantSession(Session):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.restaurante_id: int | None = None

@event.listens_for(Session, "do_orm_execute")
def _add_tenant_id_filtering_criteria(execute_state):
    # Garante que a filtragem se aplica apenas a consultas SELECT comuns de entidades
    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
    ):
        tenant_id = current_restaurante_id.get()  # Fonte única de verdade segura
        if tenant_id is not None:
            # Aplica recursivamente o filtro para todas as classes mapeadas que tenham "restaurante_id"
            for mapper in Base.registry.mappers:
                cls = mapper.class_
                if hasattr(cls, "restaurante_id"):
                    execute_state.statement = execute_state.statement.options(
                        with_loader_criteria(
                            cls,
                            lambda target_cls: target_cls.restaurante_id == tenant_id,
                            track_closure_variables=True
                        )
                    )


# Connection pool tuning for PostgreSQL (Supabase/Railway)
# SQLite uses StaticPool internally and doesn't accept these args
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=10,
        max_overflow=5,
        pool_recycle=1800,
        pool_pre_ping=True,
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

def get_tenant_id_str(restaurante_id: int | None) -> str:
    if restaurante_id is not None and isinstance(restaurante_id, int) and not isinstance(restaurante_id, bool) and restaurante_id > 0:
        return str(restaurante_id)
    return "0"

# DB Session dependency generator supporting dynamic tenant databases
def get_db(request: Request = None):
    tenant_id = "default"
    restaurante_id = current_restaurante_id.get()  # Lê a variável de contexto centralizada definida pelo middleware

    if request:
        tenant_id = request.headers.get("X-Tenant-ID", "default")

    try:
        import sentry_sdk
        sentry_sdk.set_tag("tenant_id", tenant_id)
        sentry_sdk.set_tag("restaurante_id", str(restaurante_id) if restaurante_id is not None else "")
    except Exception:
        pass

    db = SessionLocal()
    db.restaurante_id = restaurante_id

    # Injeta 'SET LOCAL' na sessão do PostgreSQL para o RLS (Row Level Security)
    # Quando o tenant estiver ausente, zero ou inválido, usa o sentinela textual "0" para que o RLS bloqueie o acesso sem erro de sintaxe SQL
    target_id_str = get_tenant_id_str(restaurante_id)

    if settings.DATABASE_URL.startswith("sqlite"):
        # SQLite em ambiente de testes unitários não suporta o comando PostgreSQL SET LOCAL e é ignorado com segurança
        pass
    else:
        try:
            db.execute(text("SET LOCAL app.current_restaurante_id = :id"), {"id": target_id_str})
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Falha ao configurar SET LOCAL app.current_restaurante_id no PostgreSQL: {e}")
            raise

    try:
        yield db
    finally:
        db.close()