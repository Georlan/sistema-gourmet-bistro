"""Configuração efetiva de fidelidade, sem persistência durante consultas."""
from sqlalchemy.orm import Session

from ..models import ConfigFidelizacao


def effective_loyalty_config(db: Session, restaurante_id: int) -> ConfigFidelizacao:
    # Sem configuração persistida, os fluxos financeiros não concedem pontos.
    # Consultar deve refletir esse estado; ativação exige o POST de configuração.
    with db.no_autoflush:
        config = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == restaurante_id,
        ).first()
    if config is not None:
        return config
    # ID 0 identifica somente a resposta virtual; nunca é adicionado à sessão.
    return ConfigFidelizacao(
        id=0, restaurante_id=restaurante_id, ativo=False,
        tipo_recompensa="PONTOS", taxa_conversao=1.0,
        valor_ponto_em_dinheiro=0.05,
    )
