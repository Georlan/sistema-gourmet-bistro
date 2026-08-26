from fastapi import APIRouter, HTTPException, Request, status

from ..database import current_restaurante_id


router = APIRouter(tags=["Cardapio Digital Compatibility"])


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
