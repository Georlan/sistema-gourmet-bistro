# FastAPI Routes Package

# Importar o módulo registra os hooks transacionais do ledger financeiro antes
# de qualquer rota de caixa processar pagamentos. Não há side effect externo:
# apenas listeners SQLAlchemy vinculados à mesma Session da aplicação.
from .. import financial_models as _financial_models  # noqa: F401

# O adaptador de leitura substitui, antes de main.py incluir os routers, somente
# os endpoints financeiros auditados da Etapa 3B. As demais rotas legadas
# permanecem intactas. A ordem é intencional: relatorios/optimization são
# carregados e então recebem as implementações reconciliadas por turno.
from . import financial_read_routes as _financial_read_routes  # noqa: F401,E402
