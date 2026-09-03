# FastAPI Routes Package

# Importar os módulos registra os modelos/listeners financeiros antes de
# qualquer rota de caixa processar pagamentos ou estornos.
from .. import financial_models as _financial_models  # noqa: F401
from .. import financial_refund_models as _financial_refund_models  # noqa: F401,E402
from .. import financial_cash_constraints as _financial_cash_constraints  # noqa: F401,E402

# O billing da Fase 3 é composto no router já montado em /api/super-admin.
# A ordem evita ciclo: autenticação/helpers do Super Admin carregam primeiro;
# depois o subrouter de cobrança é anexado ao mesmo owner HTTP.
from . import super_admin as _super_admin  # noqa: E402
from . import super_admin_billing as _super_admin_billing  # noqa: E402

_super_admin.router.include_router(_super_admin_billing.router)
