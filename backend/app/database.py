from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session, with_loader_criteria
from contextvars import ContextVar
from fastapi import Request
import os
from .config import settings

# AJUSTADO: connect_args agora é condicional para não travar no PostgreSQL (Supabase)
connect_args = {"connect_timeout": 10}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30.0}

Base = declarative_base()

# ContextVar to track the logical restaurante_id for the current request context
current_restaurante_id: ContextVar[int | None] = ContextVar("current_restaurante_id", default=None)


def require_tenant_id() -> int:
    """
    Retorna o restaurante_id do contexto autenticado atual.
    Lança HTTP 401 se o contexto não estiver preenchido.
    Nunca retorna fallback como 1 — cada rota deve ter tenant explícito.
    """
    from fastapi import HTTPException
    rid = current_restaurante_id.get()
    if rid is None:
        raise HTTPException(
            status_code=401,
            detail="Sessão sem tenant identificado. Faça login novamente."
        )
    return rid

class TenantSession(Session):
    def __init__(self, *args, **kwargs):
        restaurante_id = kwargs.pop("restaurante_id", current_restaurante_id.get())
        super().__init__(*args, **kwargs)
        self.restaurante_id: int | None = restaurante_id


def _valid_tenant_id(restaurante_id: object) -> bool:
    return (
        isinstance(restaurante_id, int)
        and not isinstance(restaurante_id, bool)
        and restaurante_id > 0
    )


def bind_session_to_tenant(db: TenantSession, restaurante_id: int) -> None:
    """Vincula uma sessão a um tenant antes da próxima transação.

    Uma transação já iniciada pode ter recebido o sentinela RLS ``0``. Nesse
    caso ela é descartada antes de trocar o tenant, impedindo que a mesma
    transação mude de identidade no meio do caminho.
    """
    if not _valid_tenant_id(restaurante_id):
        raise ValueError("restaurante_id deve ser um inteiro positivo")
    if db.in_transaction():
        db.rollback()
    db.restaurante_id = restaurante_id


@event.listens_for(TenantSession, "after_begin")
def _set_postgres_tenant_for_transaction(session, transaction, connection):
    """Aplica o tenant em toda transação, inclusive sessões de background."""
    if connection.dialect.name != "postgresql":
        return

    restaurante_id = session.restaurante_id
    if not _valid_tenant_id(restaurante_id):
        restaurante_id = current_restaurante_id.get()
    target_id = get_tenant_id_str(restaurante_id)
    connection.execute(
        text("SELECT set_config('app.current_restaurante_id', :id, true)"),
        {"id": target_id},
    )
    session.restaurante_id = restaurante_id if _valid_tenant_id(restaurante_id) else None

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

    # O listener ``after_begin`` aplica SET LOCAL em toda transação. Isso evita
    # que sessões criadas fora do dependency HTTP (jobs/background) pulem o RLS.
    db = SessionLocal(restaurante_id=restaurante_id)

    try:
        yield db
    finally:
        db.close()


def validate_postgres_runtime_role() -> None:
    """Falha cedo quando DATABASE_URL usa uma identidade capaz de ignorar RLS."""
    if engine.dialect.name != "postgresql":
        return

    print("[DATABASE] Validando role PostgreSQL de runtime...", flush=True)
    with engine.connect() as connection:
        role = connection.execute(text("""
            SELECT
                current_user AS role_name,
                rol.rolsuper AS is_superuser,
                rol.rolbypassrls AS bypass_rls,
                pg_has_role(current_user, 'koma_app', 'member') AS is_koma_app,
                EXISTS (
                    SELECT 1
                    FROM pg_class cls
                    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
                    WHERE ns.nspname = 'public'
                      AND cls.relkind = 'r'
                      AND pg_get_userbyid(cls.relowner) = current_user
                      AND (
                          cls.relname = 'restaurantes'
                          OR EXISTS (
                              SELECT 1
                              FROM information_schema.columns col
                              WHERE col.table_schema = 'public'
                                AND col.table_name = cls.relname
                                AND col.column_name = 'restaurante_id'
                          )
                      )
                ) AS owns_tenant_table
            FROM pg_roles rol
            WHERE rol.rolname = current_user
        """)).mappings().one()

    failures = []
    if role["is_superuser"]:
        failures.append("é superuser")
    if role["bypass_rls"]:
        failures.append("possui BYPASSRLS")
    if role["owns_tenant_table"]:
        failures.append("é proprietário de tabela tenant")
    if not role["is_koma_app"]:
        failures.append("não é membro da role koma_app")
    if failures:
        if os.getenv("STRICT_RLS_ROLE_CHECK", "false").lower() == "true":
            raise RuntimeError(
                "DATABASE_URL insegura para o runtime PostgreSQL: "
                f"role {role['role_name']!r} " + ", ".join(failures) + ". "
                "Use uma role LOGIN dedicada, sem SUPERUSER/BYPASSRLS e membro de koma_app."
            )
        else:
            print(
                f"[DATABASE] Aviso: Role PostgreSQL {role['role_name']!r} ({', '.join(failures)}). "
                "Executando sem trava estrita para ambiente PaaS (Railway).",
                flush=True,
            )
    else:
        print(
            f"[DATABASE] Role de runtime {role['role_name']!r} validada com segurança.",
            flush=True,
        )
