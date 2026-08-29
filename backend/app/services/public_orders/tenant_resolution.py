"""Resolução de tenant/restaurante a partir de identificadores públicos (ID ou slug)."""

from __future__ import annotations

from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...database import bind_session_to_tenant, current_restaurante_id
from ...models import Usuario


def resolve_restaurant_id(
    restaurante_id: Optional[str],
    slug: Optional[str],
    db: Session,
    current_user: Optional[Usuario] = None,
    *,
    bind_session: bool = True,
) -> int:
    """
    Resolve um identificador público sem consultar tabelas tenant via ORM.

    No PostgreSQL, a função SECURITY DEFINER é a única operação autorizada antes
    de a sessão receber o tenant. Consumidores diretos mantêm o comportamento
    legado de vincular a sessão; escopos temporários usam ``bind_session=False``
    e deixam a troca/restauração sob responsabilidade de ``tenant_session_scope``.
    """
    restaurant_identifier = (
        str(restaurante_id).strip() if restaurante_id is not None else ""
    )
    slug_identifier = str(slug).strip() if slug is not None else ""
    identifier = restaurant_identifier or slug_identifier

    if identifier:
        if len(identifier) > 128:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Identificador de restaurante inválido.",
            )

        if db.get_bind().dialect.name == "postgresql":
            resolved_id = db.execute(
                text(
                    "SELECT id "
                    "FROM koma_internal.resolve_public_restaurant(:identifier)"
                ),
                {"identifier": identifier},
            ).scalar_one_or_none()
        else:
            # Compatibilidade com SQLite nos testes locais. SQL textual evita
            # que um contexto anterior altere a resolução do identificador.
            resolved_id = db.execute(
                text(
                    """
                    SELECT id
                    FROM restaurantes
                    WHERE CAST(id AS TEXT) = :identifier
                       OR lower(COALESCE(slug, '')) = lower(:identifier)
                    ORDER BY CASE
                        WHEN CAST(id AS TEXT) = :identifier THEN 0
                        ELSE 1
                    END
                    LIMIT 1
                    """
                ),
                {"identifier": identifier},
            ).scalar_one_or_none()

        if resolved_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Restaurante não encontrado.",
            )

        rest_id = int(resolved_id)
    else:
        rest_id = current_restaurante_id.get()
        if rest_id is None and current_user is not None:
            rest_id = (
                getattr(current_user, "tenant_id", None)
                or getattr(current_user, "restaurante_id", None)
            )

        if not isinstance(rest_id, int) or isinstance(rest_id, bool) or rest_id <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Identificador de restaurante é obrigatório.",
            )

    if bind_session:
        bind_session_to_tenant(db, rest_id)
    return rest_id
