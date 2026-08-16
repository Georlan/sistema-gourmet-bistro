# FastAPI Routes Package

# Importar o módulo registra os hooks transacionais do ledger financeiro antes
# de qualquer rota de caixa processar pagamentos. Não há side effect externo:
# apenas listeners SQLAlchemy vinculados à mesma Session da aplicação.
from .. import financial_models as _financial_models  # noqa: F401

# Os adaptadores de leitura substituem, antes de main.py incluir os routers,
# somente endpoints auditados da Etapa 3B. As demais rotas legadas permanecem
# intactas. A ordem é intencional: primeiro reconcilia as leituras financeiras,
# depois separa desempenho operacional de produto de receita reconhecida.
from . import financial_read_routes as _financial_read_routes  # noqa: F401,E402
from . import financial_product_routes as _financial_product_routes  # noqa: F401,E402
