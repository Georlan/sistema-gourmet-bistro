"""Permissões operacionais configuráveis do aplicativo do garçom.

O frontend usa as mesmas chaves para orientar a interface, mas esta camada é
a fonte de autorização: esconder um botão nunca substitui a validação no
servidor.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .database import require_tenant_id
from .models import ConfiguracaoRestaurante, Usuario
from .services.plan_entitlements import (
    ENTITLEMENT_PRINTING,
    has_plan_entitlement,
)


WAITER_PERMISSION_MESSAGES = {
    "perm_garcom_delivery": "lançar pedidos de delivery ou retirada",
    "perm_garcom_editar": "editar itens de pedidos já enviados",
    "perm_garcom_cancelar": "cancelar itens de pedidos",
    "perm_garcom_print": "imprimir pedidos automaticamente",
    "perm_garcom_fechar": "fechar contas",
    "perm_garcom_transferir_mesa": "transferir ou mesclar mesas",
    "perm_garcom_transferir_item": "dividir ou transferir itens",
}


UNRESTRICTED_OPERATIONAL_ROLES = frozenset({"admin", "superadmin", "gerente", "caixa"})
ATTENDANT_ALLOWED_PERMISSIONS = frozenset({"perm_garcom_delivery", "perm_garcom_print"})
SALON_OPERATOR_ROLES = frozenset({"admin", "superadmin", "gerente", "caixa", "garcom"})
ORDER_READER_ROLES = frozenset({"admin", "superadmin", "gerente", "caixa", "garcom", "atendente", "cozinha"})


def _normalized_role(user: Usuario) -> str:
    return str(user.role or user.cargo or "").lower().strip()


def _is_active_user(user: Usuario) -> bool:
    status_val = str(getattr(user, "status", "ativo") or "ativo").lower().strip()
    return status_val == "ativo"


def is_waiter(user: Usuario) -> bool:
    return _normalized_role(user) == "garcom"


def waiter_permission_enabled(
    db: Session,
    user: Usuario,
    permission: str,
) -> bool:
    """Avalia permissões operacionais com allowlist explícita por cargo.

    Somente gestão/caixa possuem acesso irrestrito; ``atendente`` fica restrito
    ao fluxo de pedido rápido; ``garcom`` segue as flags configuráveis do
    restaurante; cargos como ``cozinha`` e ``motoboy`` são sempre negados.
    """
    if permission not in WAITER_PERMISSION_MESSAGES:
        raise RuntimeError(f"Permissão de garçom desconhecida: {permission}")
    if not _is_active_user(user):
        return False

    role = _normalized_role(user)
    if role == "superadmin":
        return True

    restaurante_id = require_tenant_id()
    if user.restaurante_id != restaurante_id:
        return False

    if role in UNRESTRICTED_OPERATIONAL_ROLES:
        return True

    if role == "atendente":
        if permission not in ATTENDANT_ALLOWED_PERMISSIONS:
            return False
        if permission == "perm_garcom_print" and not has_plan_entitlement(
            db,
            restaurante_id,
            ENTITLEMENT_PRINTING,
        ):
            return False
        return True

    if role != "garcom":
        return False

    # A permissão configurável não pode reativar uma capacidade comercial que
    # o plano não possui. No Pocket, o App do Garçom continua funcional, mas
    # qualquer ação de impressão é efetivamente desabilitada.
    if permission == "perm_garcom_print" and not has_plan_entitlement(
        db,
        restaurante_id,
        ENTITLEMENT_PRINTING,
    ):
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
    if is_waiter(user):
        detail = f"Permissão negada para o garçom {action}. Contate o gerente."
    else:
        role = _normalized_role(user) or "desconhecido"
        detail = f"Acesso negado: o cargo '{role}' não possui permissão para {action}."
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail,
    )


def require_salon_order_operator(
    user: Usuario,
    action: str = "operar pedidos e mesas do salão",
) -> None:
    """Restringe mutações de salão/comandas a gestão, caixa e garçom."""
    if not _is_active_user(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário pendente, inativa ou bloqueada.",
        )
    role = _normalized_role(user)
    if role != "superadmin" and getattr(user, "restaurante_id", None) != require_tenant_id():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso negado: operador fora do restaurante atual.",
        )
    if role in SALON_OPERATOR_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Acesso negado: o cargo '{role or 'desconhecido'}' não possui permissão para {action}.",
    )


def require_order_reader(user: Usuario) -> None:
    """Bloqueia leitura ampla de comandas/PII por cargos sem visão de pedidos (ex: motoboy)."""
    if not _is_active_user(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário pendente, inativa ou bloqueada.",
        )
    role = _normalized_role(user)
    if role != "superadmin" and getattr(user, "restaurante_id", None) != require_tenant_id():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso negado: operador fora do restaurante atual.",
        )
    if role in ORDER_READER_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            f"Acesso negado: o cargo '{role or 'desconhecido'}' não possui permissão "
            "para consultar listagens gerais de pedidos."
        ),
    )
