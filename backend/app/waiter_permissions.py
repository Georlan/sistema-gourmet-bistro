"""Permissões operacionais configuráveis do aplicativo do garçom.

O frontend usa as mesmas chaves para orientar a interface, mas esta camada é
a fonte de autorização: esconder um botão nunca substitui a validação no
servidor.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .database import require_tenant_id
from .models import ConfiguracaoRestaurante, Usuario


WAITER_PERMISSION_MESSAGES = {
    "perm_garcom_delivery": "lançar pedidos de delivery ou retirada",
    "perm_garcom_editar": "editar itens de pedidos já enviados",
    "perm_garcom_cancelar": "cancelar itens de pedidos",
    "perm_garcom_print": "imprimir pedidos automaticamente",
    "perm_garcom_fechar": "fechar contas",
    "perm_garcom_transferir_mesa": "transferir ou mesclar mesas",
    "perm_garcom_transferir_item": "dividir ou transferir itens",
}


def is_waiter(user: Usuario) -> bool:
    role = str(user.role or user.cargo or "").lower().strip()
    return role == "garcom"


def waiter_permission_enabled(
    db: Session,
    user: Usuario,
    permission: str,
) -> bool:
    """Retorna a configuração do restaurante; outros cargos não são limitados."""
    if permission not in WAITER_PERMISSION_MESSAGES:
        raise RuntimeError(f"Permissão de garçom desconhecida: {permission}")
    if not is_waiter(user):
        return True

    restaurante_id = require_tenant_id()
    if user.restaurante_id != restaurante_id:
        return False

    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == restaurante_id,
    ).first()
    # Ausência de configuração deve falhar de forma segura, sem conceder uma
    # operação sensível por causa de uma linha ainda não criada.
    return bool(config and getattr(config, permission, False))


def require_waiter_permission(
    db: Session,
    user: Usuario,
    permission: str,
) -> None:
    if waiter_permission_enabled(db, user, permission):
        return
    action = WAITER_PERMISSION_MESSAGES[permission]
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Permissão negada para o garçom {action}. Contate o gerente.",
    )
