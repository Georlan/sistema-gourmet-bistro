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

# Compatibilidade isolada sobre as rotas legadas: continua existindo UMA fonte
# transacional para estorno, UMA leitura de saldo estornável e UMA composição
# do feed do turno.
from ..services import cash_reconciliation as _cash_reconciliation  # noqa: E402
from ..services.refund_guard import (  # noqa: E402
    create_refund_guarded as _create_refund_guarded,
    remaining_refund_allocations_guarded as _remaining_refund_allocations_guarded,
)
from ..services.cash_activity import recent_cash_activities as _recent_cash_activities  # noqa: E402

_financial_cash_routes.create_refund = _create_refund_guarded
_financial_cash_routes.remaining_refund_allocations = _remaining_refund_allocations_guarded
_cash_reconciliation.remaining_refund_allocations = _remaining_refund_allocations_guarded
_financial_cash_routes.legacy_cash._atividades_recentes_turno = _recent_cash_activities
