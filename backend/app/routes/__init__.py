# FastAPI Routes Package

# Importar os módulos registra os modelos/listeners financeiros antes de
# qualquer rota de caixa processar pagamentos ou estornos.
from .. import financial_models as _financial_models  # noqa: F401
from .. import financial_refund_models as _financial_refund_models  # noqa: F401,E402

# Adaptadores auditados da Etapa 3. A ordem é intencional:
# 3B reconcilia leitura/relatórios; 3C injeta a fonte única do turno e as rotas
# operacionais de estorno/fechamento.
from . import financial_read_routes as _financial_read_routes  # noqa: F401,E402
from . import financial_product_routes as _financial_product_routes  # noqa: F401,E402
from . import financial_cash_routes as _financial_cash_routes  # noqa: F401,E402
