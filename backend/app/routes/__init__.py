# FastAPI Routes Package

# Importar o módulo registra os hooks transacionais do ledger financeiro antes
# de qualquer rota de caixa processar pagamentos. Não há side effect externo:
# apenas listeners SQLAlchemy vinculados à mesma Session da aplicação.
from .. import financial_models as _financial_models  # noqa: F401
