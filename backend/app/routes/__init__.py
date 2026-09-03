# FastAPI Routes Package

# Importar os módulos registra os modelos/listeners financeiros antes de
# qualquer rota de caixa processar pagamentos ou estornos.
from .. import financial_models as _financial_models  # noqa: F401
from .. import financial_refund_models as _financial_refund_models  # noqa: F401,E402
from .. import financial_cash_constraints as _financial_cash_constraints  # noqa: F401,E402

# O main já monta `super_admin.router` em /api. A central de acessos é composta
# como sub-router para manter os poderes administrativos em um único control plane
# sem duplicar o registro do prefixo /super-admin.
from . import super_admin as _super_admin  # noqa: E402,F401
from .super_admin_access import router as _super_admin_access_router  # noqa: E402

_super_admin.router.include_router(_super_admin_access_router)
