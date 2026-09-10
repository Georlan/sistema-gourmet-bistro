from fastapi import APIRouter, HTTPException, Request, status

from ..database import current_restaurante_id
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
def legacy_cardapio_config_bridge(request: Request):
    """Compatibilidade interna para a montagem antiga do Caixa sem nova leitura do restaurante.

    A tela moderna de Cardápio Online carrega a configuração real exclusivamente em
    ``/api/cardapio-digital/config``. O Caixa ainda dispara este GET durante a montagem
    do formulário legado oculto; responder a partir do tenant já validado pelo middleware
    evita uma segunda consulta ao banco enquanto essa montagem é removida do componente
    monolítico.
    """
    authorization = (request.headers.get("Authorization") or "").strip()
    restaurante_id = current_restaurante_id.get()
    if not authorization or not isinstance(restaurante_id, int) or restaurante_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária.",
        )

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
