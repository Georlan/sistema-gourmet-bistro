from fastapi import APIRouter, Depends

from ..database import require_tenant_id
from ..models import Usuario
from ..security import get_current_user
from .cardapio_popular import listar_produtos_populares


router = APIRouter(tags=["Cardapio Digital Compatibility"])

# Este módulo é importado diretamente pelo main antes de app.include_router().
# Registrar o handler nesta instância evita composição tardia entre APIRouters,
# que o FastAPI não retropropaga depois que as rotas são copiadas para a app.
router.add_api_route(
    "/api/cardapio-digital/populares",
    listar_produtos_populares,
    methods=["GET"],
    tags=["Cardapio Digital Assets"],
)


@router.get("/caixa/config-cardapio")
def legacy_cardapio_config_bridge(
    current_user: Usuario = Depends(get_current_user),
):
    """Compatibilidade interna para a montagem antiga do Caixa sem nova leitura do restaurante.

    A tela moderna de Cardápio Online carrega a configuração real exclusivamente em
    ``/api/cardapio-digital/config``. O Caixa ainda dispara este GET durante a montagem
    do formulário legado oculto; exigir ``get_current_user`` garante que tokens
    revogados, contas desativadas ou tenants suspensos sejam rejeitados.
    """
    del current_user
    restaurante_id = require_tenant_id()

    return {
        "id": restaurante_id,
        "status_override": "Automático",
        "cor_primaria": "#00b894",
        "cor_fundo": "#090a0f",
        "logo_url": None,
        "banner_url": None,
        "sobre_nos": None,
        "endereco": None,
        "deprecated_bridge": True,
    }
