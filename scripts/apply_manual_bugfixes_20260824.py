from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


APP = "src/App.tsx"
CAIXA = "src/components/CaixaPanel.tsx"
ESTORNO = "src/components/caixa/EstornoModal.tsx"
WS_MANAGER = "backend/app/websocket_manager.py"
WS_ROUTE = "backend/app/routes/websocket.py"
REFUND_UI = "backend/app/services/refund_ui.py"
WS_CREDENTIALS_TEST = "backend/tests/test_websocket_credentials.py"
WS_SEGMENTATION_TEST = "backend/tests/test_websocket_segmentation.py"

# WebSocket: respect the dedicated WS endpoint and derive the legacy path hint
# from the current JWT. The backend remains the authority for identity.
replace_once(
    APP,
    "import { API_BASE_URL } from './config/api';",
    "import { API_BASE_URL, WS_BASE_URL } from './config/api';",
)
replace_once(
    APP,
    "export default function App() {",
    """const readJwtSubject = (token: string): string => {\n  try {\n    const payloadPart = token.split('.')[1];\n    if (!payloadPart) return '';\n    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');\n    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');\n    const payload = JSON.parse(window.atob(padded));\n    return String(payload?.sub || '').trim();\n  } catch {\n    return '';\n  }\n};\n\nexport default function App() {""",
)
replace_once(
    APP,
    """      const wsBase = API_BASE_URL.replace(/^http/, 'ws');\n      const tokenKey = portal === 'caixa' ? \"koma_caixa_token\" : \"koma_waiter_token\";\n      const token = localStorage.getItem(tokenKey) || \"\";\n      const wsUrl = `${wsBase}/ws/${encodeURIComponent(activeWaiterId)}`;\n      const socket = openAuthenticatedWebSocket(wsUrl, token);\n""",
    """      const wsBase = WS_BASE_URL.replace(/\\/+$/, '');\n      const tokenKey = portal === 'caixa' ? \"koma_caixa_token\" : \"koma_waiter_token\";\n      const token = localStorage.getItem(tokenKey) || \"\";\n      const wsIdentity = readJwtSubject(token) || activeWaiterId;\n      if (!token || !wsIdentity) return;\n      const wsUrl = `${wsBase}/ws/${encodeURIComponent(wsIdentity)}`;\n      const socket = openAuthenticatedWebSocket(wsUrl, token);\n""",
)

# Negotiate the authentication subprotocol explicitly. This makes the browser,
# Starlette and reverse proxy agree on the selected WebSocket protocol.
replace_once(
    WS_MANAGER,
    """        client_type: str = \"internal\"\n    ) -> None:\n""",
    """        client_type: str = \"internal\",\n        subprotocol: str | None = None,\n    ) -> None:\n""",
)
replace_once(
    WS_MANAGER,
    "        await websocket.accept()\n",
    "        await websocket.accept(subprotocol=subprotocol)\n",
)

# The /ws/{id} segment is legacy routing metadata. Canonical identity must come
# only from the verified JWT + database, so stale localStorage can never reject
# an otherwise valid session.
replace_once(
    WS_ROUTE,
    """    if not token_user_id or not requested_user_id or token_user_id != requested_user_id:\n        raise ValueError(\"Identidade do WebSocket diverge do token autenticado.\")\n""",
    """    if not token_user_id:\n        raise ValueError(\"Identidade ausente no token do WebSocket.\")\n""",
)
replace_once(
    WS_ROUTE,
    """    await manager.connect(websocket, restaurante_id_val, client_type=\"internal\")\n""",
    """    await manager.connect(\n        websocket,\n        restaurante_id_val,\n        client_type=\"internal\",\n        subprotocol=KOMA_AUTH_SUBPROTOCOL,\n    )\n""",
)

# Checkout: when ready items are selected, show the amount being received and
# the projected remaining balance instead of the untouched full-table balance.
replace_once(
    CAIXA,
    """                  {(() => {\n                    const { subtotal, taxa } = getCheckoutTotals(selectedOrder);\n                    return (\n""",
    """                  {(() => {\n                    const { subtotal, taxa } = getCheckoutTotals(selectedOrder);\n                    const currentBalance = getCheckoutBalance(selectedOrder);\n                    const selectedTotal = selectedItemIds.length > 0\n                      ? getSelectedItemsTotal(selectedOrder, selectedItemIds)\n                      : 0;\n                    const projectedBalance = Math.max(0, currentBalance - selectedTotal);\n                    return (\n""",
)
replace_once(
    CAIXA,
    """                            <span>R$ {getSelectedItemsTotal(\n                              selectedOrder,\n                              selectedItemIds\n                            ).toFixed(2)}</span>\n""",
    """                            <span>R$ {selectedTotal.toFixed(2)}</span>\n""",
)
replace_once(
    CAIXA,
    """                        <div className={clsx('flex', 'justify-between', 'border-t', 'border-koma-border', 'pt-2', 'text-sm', 'text-emerald-700 dark:text-emerald-400', 'font-bold')}>\n                          <span className=\"font-sans\">Saldo Restante:</span>\n                          <span>R$ {getCheckoutBalance(selectedOrder).toFixed(2)}</span>\n                        </div>\n""",
    """                        <div className={clsx('flex', 'justify-between', 'border-t', 'border-koma-border', 'pt-2', 'text-sm', 'text-emerald-700 dark:text-emerald-400', 'font-bold')}>\n                          <span className=\"font-sans\">{selectedItemIds.length > 0 ? 'Restará após receber:' : 'Saldo restante:'}</span>\n                          <span>R$ {(selectedItemIds.length > 0 ? projectedBalance : currentBalance).toFixed(2)}</span>\n                        </div>\n""",
)
replace_once(
    CAIXA,
    """                  <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-koma-card', 'p-3', 'rounded-2xl', 'border', 'border-koma-border')}>\n                    <div className=\"space-y-1\">\n                      <label className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Pessoas:</label>\n                      <input\n                        type=\"number\"\n                        min=\"1\"\n                        value={splitPeople}\n                        onChange={(e) => {\n                          const val = e.target.value;\n                          setSplitPeople(val);\n                          setSelectedItemIds([]);\n                          const peopleNum = parseInt(val, 10) || 1;\n                          setPaymentValor((getCheckoutBalance(selectedOrder) / peopleNum));\n                        }}\n                        className={clsx('w-full', 'px-3', 'py-1.5', 'text-xs', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'focus:outline-none', 'text-koma-foreground', 'text-center', 'font-mono')}\n                      />\n                    </div>\n                    <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>\n                      <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Valor por Pessoa:</span>\n                      <span className={clsx('text-sm', 'font-bold', 'text-koma-foreground', 'font-mono', 'leading-relaxed')}>\n                        R$ {(() => {\n                          const peopleNum = parseInt(splitPeople, 10) || 1;\n                          return (getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2);\n                        })()}\n                      </span>\n                    </div>\n                  </div>\n""",
    """                  {selectedItemIds.length > 0 ? (\n                    <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-koma-card', 'p-3', 'rounded-2xl', 'border', 'border-koma-border')}>\n                      <div>\n                        <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Itens prontos</span>\n                        <strong className={clsx('mt-1', 'block', 'text-sm', 'text-koma-foreground', 'font-mono')}>{selectedItemIds.length}</strong>\n                      </div>\n                      <div className=\"text-right\">\n                        <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Recebendo agora</span>\n                        <strong className={clsx('mt-1', 'block', 'text-sm', 'text-emerald-700 dark:text-emerald-300', 'font-mono')}>\n                          R$ {getSelectedItemsTotal(selectedOrder, selectedItemIds).toFixed(2)}\n                        </strong>\n                      </div>\n                    </div>\n                  ) : (\n                    <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-koma-card', 'p-3', 'rounded-2xl', 'border', 'border-koma-border')}>\n                      <div className=\"space-y-1\">\n                        <label className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Pessoas:</label>\n                        <input\n                          type=\"number\"\n                          min=\"1\"\n                          value={splitPeople}\n                          onChange={(e) => {\n                            const val = e.target.value;\n                            setSplitPeople(val);\n                            const peopleNum = parseInt(val, 10) || 1;\n                            setPaymentValor((getCheckoutBalance(selectedOrder) / peopleNum));\n                          }}\n                          className={clsx('w-full', 'px-3', 'py-1.5', 'text-xs', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'focus:outline-none', 'text-koma-foreground', 'text-center', 'font-mono')}\n                        />\n                      </div>\n                      <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>\n                        <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Valor por pessoa:</span>\n                        <span className={clsx('text-sm', 'font-bold', 'text-koma-foreground', 'font-mono', 'leading-relaxed')}>\n                          R$ {(() => {\n                            const peopleNum = parseInt(splitPeople, 10) || 1;\n                            return (getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2);\n                          })()}\n                        </span>\n                      </div>\n                    </div>\n                  )}\n""",
)

# Refund allocation: multiple internal comandas can belong to the same account.
# Include the order number so two portions never look duplicated to the operator.
replace_once(
    REFUND_UI,
    """        if attendance is not None:\n            label = f\"Conta #{attendance.numero_conta}\"\n            if attendance.mesa_id:\n                label += f\" · Mesa {attendance.mesa_id}\"\n        else:\n""",
    """        if attendance is not None:\n            label = f\"Conta #{attendance.numero_conta}\"\n            if attendance.mesa_id:\n                label += f\" · Mesa {attendance.mesa_id}\"\n            if command is not None and command.numero_pedido:\n                label += f\" · Pedido #{command.numero_pedido}\"\n            elif command is not None:\n                label += f\" · Parte {str(command.id)[-6:]}\"\n        else:\n""",
)

# Refund modal: on narrow screens, scroll the stacked body instead of clipping
# the selected payment form below the payment list.
replace_once(
    ESTORNO,
    """        <div className=\"grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,.85fr)_minmax(0,1.15fr)]\">\n""",
    """        <div className=\"grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(280px,.85fr)_minmax(0,1.15fr)] lg:overflow-hidden\">\n""",
)
replace_once(
    ESTORNO,
    """          <section className=\"min-h-0 overflow-y-auto p-5\">\n""",
    """          <section className=\"p-5 lg:min-h-0 lg:overflow-y-auto\">\n""",
)

# Regression tests for the production WebSocket failure mode.
with Path(WS_CREDENTIALS_TEST).open("a", encoding="utf-8") as fh:
    fh.write("""\n\ndef test_internal_websocket_identity_ignores_stale_legacy_path(monkeypatch):\n    from app.routes import websocket as websocket_route\n\n    fake_db = SimpleNamespace(close=lambda: None)\n    monkeypatch.setattr(\n        websocket_route.jwt,\n        \"decode\",\n        lambda *args, **kwargs: {\"sub\": \"canonical-user\", \"restaurante_id\": 77},\n    )\n    monkeypatch.setattr(\n        websocket_route,\n        \"SessionLocal\",\n        lambda restaurante_id=None: fake_db,\n    )\n    monkeypatch.setattr(\n        websocket_route,\n        \"_authenticated_user_from_token\",\n        lambda token, db: SimpleNamespace(id=\"canonical-user\", nome=\"Caixa\"),\n    )\n\n    assert websocket_route._validated_internal_websocket_identity(\n        \"valid.jwt.token\",\n        \"stale-local-storage-id\",\n    ) == (77, \"canonical-user\", \"Caixa\")\n""")

with Path(WS_SEGMENTATION_TEST).open("a", encoding="utf-8") as fh:
    fh.write("""\n\ndef test_internal_websocket_negotiates_auth_subprotocol():\n    async def exercise():\n        manager = ConnectionManager()\n        socket = AsyncMock()\n        await manager.connect(\n            socket,\n            9,\n            client_type=\"internal\",\n            subprotocol=\"koma-auth\",\n        )\n        socket.accept.assert_awaited_once_with(subprotocol=\"koma-auth\")\n\n    asyncio.run(exercise())\n""")
