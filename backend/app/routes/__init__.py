# FastAPI Routes Package

# Importar os módulos registra os modelos/listeners financeiros antes de
# qualquer rota de caixa processar pagamentos ou estornos.
from .. import financial_models as _financial_models  # noqa: F401
from .. import financial_refund_models as _financial_refund_models  # noqa: F401,E402
from .. import financial_cash_constraints as _financial_cash_constraints  # noqa: F401,E402
from .. import contract_models as _contract_models  # noqa: F401,E402

# O main já monta `super_admin.router` em /api. A central de acessos é composta
# como sub-router para manter os poderes administrativos em um único control plane
# sem duplicar o registro do prefixo /super-admin.
from . import super_admin as _super_admin  # noqa: E402,F401
from .super_admin_access import router as _super_admin_access_router  # noqa: E402
from .super_admin_support import router as _super_admin_support_router  # noqa: E402
from .super_admin_incidents import router as _super_admin_incidents_router  # noqa: E402
from .super_admin_contracts import router as _super_admin_contracts_router  # noqa: E402

_super_admin.router.include_router(_super_admin_access_router)
_super_admin.router.include_router(_super_admin_support_router)
_super_admin.router.include_router(_super_admin_incidents_router)
_super_admin.router.include_router(_super_admin_contracts_router)

# `websocket.router` é um router raiz sem prefixo já incluído explicitamente pelo
# main. Usamos esse ponto de composição para registrar rotas auxiliares sem
# alterar a ordem histórica dos routers do runtime.
from . import websocket as _root_router  # noqa: E402
from .contracts import router as _contracts_router  # noqa: E402
from .onboarding import router as _onboarding_router  # noqa: E402

_root_router.router.include_router(_contracts_router)
_root_router.router.include_router(_onboarding_router)

# O Print Agent continua com um único owner HTTP no main. O sub-router adiciona
# apenas o plano de transporte SSE; claim, fila e regras físicas permanecem no
# router canônico de print_agents e no Core Universal de Impressão.
from . import print_agents as _print_agents  # noqa: E402
from .print_agent_events import router as _print_agent_events_router  # noqa: E402

_print_agents.router.include_router(_print_agent_events_router)
