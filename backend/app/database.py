from contextlib import contextmanager
from contextvars import ContextVar
import asyncio
import os
import weakref

from fastapi import Request
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker, with_loader_criteria

from .config import settings

# AJUSTADO: connect_args agora é condicional para não travar no PostgreSQL (Supabase)
connect_args = {"connect_timeout": 10}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30.0}

Base = declarative_base()

# ContextVar to track the logical restaurante_id for the current request context
current_restaurante_id: ContextVar[int | None] = ContextVar(
    "current_restaurante_id", default=None
)
_UNSET_TENANT = object()


class TenantScopeError(RuntimeError):
    """Indica divergência ou tentativa de escrita fora do tenant da sessão."""


def _valid_tenant_id(restaurante_id: object) -> bool:
    return (
        isinstance(restaurante_id, int)
        and not isinstance(restaurante_id, bool)
        and restaurante_id > 0
    )


def require_tenant_id() -> int:
    """
    Retorna o restaurante_id do contexto autenticado atual.
    Lança HTTP 401 se o contexto não estiver preenchido.
    Nunca retorna fallback como 1 — cada rota deve ter tenant explícito.
    """
    from fastapi import HTTPException

    rid = current_restaurante_id.get()
    if not _valid_tenant_id(rid):
        raise HTTPException(
            status_code=401,
            detail="Sessão sem tenant identificado. Faça login novamente.",
        )
    return int(rid)


class TenantSession(Session):
    def __init__(self, *args, **kwargs):
        # Uma sessão só fica permanentemente vinculada quando o chamador passa
        # restaurante_id explicitamente. SessionLocal() puro acompanha o
        # ContextVar vigente em cada operação, o que permite jobs/contextos
        # controlados mudarem de escopo antes de iniciar a transação sem manter
        # uma identidade antiga capturada no construtor.
        restaurante_id = kwargs.pop("restaurante_id", _UNSET_TENANT)
        super().__init__(*args, **kwargs)
        self.restaurante_id: int | None = (
            int(restaurante_id)
            if restaurante_id is not _UNSET_TENANT and _valid_tenant_id(restaurante_id)
            else None
        )


def _effective_tenant_id(session: Session | None = None) -> int | None:
    """Resolve uma única identidade de tenant para ORM e RLS.

    Sessões explicitamente vinculadas têm precedência. Se também existir um
    ContextVar válido, ambos precisam concordar; a aplicação falha fechada em
    vez de executar ORM sob um tenant e PostgreSQL RLS sob outro. Sessões não
    vinculadas acompanham o ContextVar atual.
    """
    session_tenant = getattr(session, "restaurante_id", None) if session else None
    context_tenant = current_restaurante_id.get()
    session_valid = _valid_tenant_id(session_tenant)
    context_valid = _valid_tenant_id(context_tenant)

    if session_valid and context_valid and int(session_tenant) != int(context_tenant):
        raise TenantScopeError(
            "Escopo multi-tenant inconsistente entre sessão e contexto da requisição."
        )
    if session_valid:
        return int(session_tenant)
    if context_valid:
        return int(context_tenant)
    return None


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
    db.restaurante_id = int(restaurante_id)


@contextmanager
def tenant_session_scope(db: TenantSession, restaurante_id: int):
    """Troca temporariamente ContextVar + sessão e restaura ambos ao sair.

    O helper é destinado a fluxos públicos que primeiro resolvem o restaurante
    e só então podem consultar tabelas protegidas. Qualquer transação ainda
    aberta é revertida ao sair para impedir que uma conexão continue carregando
    o tenant temporário. Rotas que escrevem dentro do escopo devem fazer commit
    antes do fim do bloco, como já ocorre nos fluxos de OTP e rate limit.
    """
    if not _valid_tenant_id(restaurante_id):
        raise ValueError("restaurante_id deve ser um inteiro positivo")

    previous_session_tenant = getattr(db, "restaurante_id", None)
    context_token = current_restaurante_id.set(int(restaurante_id))
    try:
        bind_session_to_tenant(db, int(restaurante_id))
        yield int(restaurante_id)
    finally:
        if db.in_transaction():
            db.rollback()
        db.restaurante_id = (
            int(previous_session_tenant)
            if _valid_tenant_id(previous_session_tenant)
            else None
        )
        current_restaurante_id.reset(context_token)


@event.listens_for(TenantSession, "after_begin")
def _set_postgres_tenant_for_transaction(session, transaction, connection):
    """Aplica o mesmo tenant efetivo do ORM a toda transação PostgreSQL."""
    if connection.dialect.name != "postgresql":
        return

    restaurante_id = _effective_tenant_id(session)
    connection.execute(
        text("SELECT set_config('app.current_restaurante_id', :id, true)"),
        {"id": get_tenant_id_str(restaurante_id)},
    )


@event.listens_for(TenantSession, "before_flush")
def _guard_tenant_writes(session, flush_context, instances):
    """Bloqueia escrita cross-tenant antes de SQL/RLS e cobre também SQLite."""
    tenant_id = _effective_tenant_id(session)
    if tenant_id is None:
        return

    seen: set[int] = set()
    for obj in list(session.new) + list(session.dirty) + list(session.deleted):
        marker = id(obj)
        if marker in seen:
            continue
        seen.add(marker)
        if not hasattr(type(obj), "restaurante_id"):
            continue

        object_tenant = getattr(obj, "restaurante_id", None)
        if obj in session.new and object_tenant is None:
            setattr(obj, "restaurante_id", tenant_id)
            object_tenant = tenant_id

        if not _valid_tenant_id(object_tenant) or int(object_tenant) != tenant_id:
            raise TenantScopeError(
                f"Escrita cross-tenant bloqueada para {type(obj).__name__}: "
                f"sessão={tenant_id}, objeto={object_tenant!r}."
            )


@event.listens_for(Session, "do_orm_execute")
def _add_tenant_id_filtering_criteria(execute_state):
    # Garante que a filtragem se aplica apenas a consultas SELECT comuns de entidades.
    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
    ):
        tenant_id = _effective_tenant_id(execute_state.session)
        if tenant_id is not None:
            # Aplica recursivamente o filtro para todas as classes mapeadas que tenham restaurante_id.
            for mapper in Base.registry.mappers:
                cls = mapper.class_
                if hasattr(cls, "restaurante_id"):
                    execute_state.statement = execute_state.statement.options(
                        with_loader_criteria(
                            cls,
                            lambda target_cls: target_cls.restaurante_id == tenant_id,
                            track_closure_variables=True,
                        )
                    )


# Connection pool tuning for PostgreSQL (Supabase/Railway)
# SQLite uses StaticPool internally and doesn't accept these args
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_recycle=settings.DB_POOL_RECYCLE,
        pool_use_lifo=True,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
SessionLocal = sessionmaker(
    class_=TenantSession,
    autocommit=False,
    autoflush=False,
    bind=engine,
)


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
        text(
            "INSERT INTO restaurantes (id, nome, plano) VALUES "
            "(1, 'Kôma Bistrô', 'pocket') ON CONFLICT (id) DO NOTHING"
        )
    )


def get_tenant_id_str(restaurante_id: int | None) -> str:
    if _valid_tenant_id(restaurante_id):
        return str(restaurante_id)
    return "0"


# Limita requisições que mantêm uma Session HTTP aberta a uma margem segura do
# QueuePool. O excesso espera de forma assíncrona antes de criar a sessão, em vez
# de ocupar workers esperando uma conexão até DB_POOL_TIMEOUT.
if settings.DATABASE_URL.startswith("sqlite"):
    _DEFAULT_DB_HTTP_MAX_INFLIGHT = 40
else:
    _DEFAULT_DB_HTTP_MAX_INFLIGHT = max(
        1,
        settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW - 2,
    )
DB_HTTP_MAX_INFLIGHT = max(
    1,
    int(os.getenv("DB_HTTP_MAX_INFLIGHT", str(_DEFAULT_DB_HTTP_MAX_INFLIGHT))),
)
_db_http_limiters: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _get_db_http_limiter() -> asyncio.Semaphore:
    """Retorna um semaphore por event loop para evitar binding cross-loop em testes."""
    loop = asyncio.get_running_loop()
    limiter = _db_http_limiters.get(loop)
    if limiter is None:
        limiter = asyncio.Semaphore(DB_HTTP_MAX_INFLIGHT)
        _db_http_limiters[loop] = limiter
    return limiter


# DB Session dependency generator supporting dynamic tenant databases
async def get_db(request: Request = None):
    """Entrega uma sessão síncrona com backpressure antes do QueuePool.

    As consultas continuam executadas pelas rotas/dependências síncronas no
    threadpool. A dependência assíncrona limita quantas sessões HTTP podem estar
    simultaneamente em voo por processo, mantendo uma pequena reserva do pool
    para sessões auxiliares/background. O excesso fica aguardando no event loop
    sem consumir uma conexão nem um worker e sem converter saturação em HTTP 500.
    """
    tenant_id = "default"
    restaurante_id = current_restaurante_id.get()

    if request:
        tenant_id = request.headers.get("X-Tenant-ID", "default")

    try:
        import sentry_sdk

        sentry_sdk.set_tag("tenant_id", tenant_id)
        sentry_sdk.set_tag(
            "restaurante_id",
            str(restaurante_id) if restaurante_id is not None else "",
        )
    except Exception:
        pass

    limiter = _get_db_http_limiter()
    await limiter.acquire()

    # O dependency HTTP sempre fixa explicitamente o tenant resolvido pelo JWT.
    # Sessões de request portanto não acompanham trocas acidentais de ContextVar.
    db = SessionLocal(restaurante_id=restaurante_id)

    try:
        yield db
    finally:
        try:
            db.close()
        finally:
            limiter.release()


def validate_postgres_runtime_role() -> None:
    """Falha cedo quando DATABASE_URL usa uma identidade capaz de ignorar RLS."""
    if engine.dialect.name != "postgresql":
        return

    print("[DATABASE] Validando role PostgreSQL de runtime...", flush=True)
    with engine.connect() as connection:
        role = connection.execute(
            text(
                """
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
            """
            )
        ).mappings().one()

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
                f"[DATABASE] Aviso: Role PostgreSQL {role['role_name']!r} "
                f"({', '.join(failures)}). Executando sem trava estrita para "
                "ambiente PaaS (Railway).",
                flush=True,
            )
    else:
        print(
            f"[DATABASE] Role de runtime {role['role_name']!r} validada com segurança.",
            flush=True,
        )
