from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 literal match, found {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 regex match, found {count}: {pattern[:100]!r}")
    p.write_text(updated, encoding="utf-8")


CAIXA = "src/components/CaixaPanel.tsx"
SERVICE = "src/config/caixaService.ts"
REFUND_MODAL = "src/components/caixa/EstornoModal.tsx"
FINANCIAL_CASH = "backend/app/routes/financial_cash_routes.py"
BACKEND_CAIXA = "backend/app/routes/caixa.py"

# 1) Pedido otimista: nunca inventar número operacional.
replace_once(
    CAIXA,
    """function humanOrderNumber(order: any): string {\n  const number = Number(order?.numeroPedido ?? order?.numero_pedido);\n  if (Number.isFinite(number) && number > 0) return String(number);\n  return String(order?.comandaId || order?.id || '—').slice(-4).toUpperCase();\n}\n""",
    """function humanOrderNumber(order: any): string {\n  const rawId = String(order?.comandaId || order?.id || '');\n  if (rawId.startsWith('temp-')) return '…';\n  const number = Number(order?.numeroPedido ?? order?.numero_pedido);\n  if (Number.isFinite(number) && number > 0) return String(number);\n  return String(order?.comandaId || order?.id || '—').slice(-4).toUpperCase();\n}\n""",
)

replace_once(
    CAIXA,
    """    const orderLabel = orderNumbers.length > 1\n      ? `Pedidos ${orderNumbers.map(number => `#${number}`).join(' + ')}`\n      : `Pedido #${orderNumbers[0] || humanOrderNumber(order)}`;\n""",
    """    const isPendingConfirmation = String(order.id || '').startsWith('temp-');\n    const orderLabel = isPendingConfirmation\n      ? 'Pedido em envio'\n      : orderNumbers.length > 1\n        ? `Pedidos ${orderNumbers.map(number => `#${number}`).join(' + ')}`\n        : `Pedido #${orderNumbers[0] || humanOrderNumber(order)}`;\n""",
)

# 2) Som: ignorar entidades temporárias e tocar apenas quando o pedido canônico chega.
replace_once(
    CAIXA,
    """    const active = orders.filter(o => o.status !== 'fechada' && o.status !== 'cancelado');\n""",
    """    const active = orders.filter(o =>\n      !String(o.id || '').startsWith('temp-')\n      && o.status !== 'fechada'\n      && o.status !== 'cancelado'\n    );\n""",
)
replace_once(
    CAIXA,
    """      if (res.ok) {\n        pdvPendingOperationRef.current = null;\n        playOrderAlert('new_order');\n        onRefreshOrders();\n        fetchDeliveryOrders();\n        window.dispatchEvent(new Event('koma_orders_updated'));\n""",
    """      if (res.ok) {\n        pdvPendingOperationRef.current = null;\n        showToast('Pedido confirmado e enviado à cozinha.', 'success');\n        onRefreshOrders();\n        fetchDeliveryOrders();\n        window.dispatchEvent(new Event('koma_orders_updated'));\n""",
)

# 3) Categorias: drag horizontal não pode capturar clique em botão.
replace_once(
    CAIXA,
    """  const handlePdvCategoryPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {\n    if (event.pointerType !== 'mouse' || event.button !== 0) return;\n    const element = pdvCategoryScrollRef.current;\n""",
    """  const handlePdvCategoryPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {\n    if (event.pointerType !== 'mouse' || event.button !== 0) return;\n    if ((event.target as HTMLElement).closest('button')) return;\n    const element = pdvCategoryScrollRef.current;\n""",
)
replace_once(
    CAIXA,
    """                        onClick={() => setPdvSelectedCategory('todos')}\n""",
    """                        onClick={() => { setPdvSelectedCategory('todos'); setPdvProductDetailId(null); }}\n""",
)
replace_once(
    CAIXA,
    """                        onClick={() => setPdvSelectedCategory(catObj.nome)}\n""",
    """                        onClick={() => { setPdvSelectedCategory(catObj.nome); setPdvProductDetailId(null); }}\n""",
)

# 4) Banner do Novo Pedido: informação operacional do pedido, não catálogo.
replace_once(
    CAIXA,
    """  const pdvMenuInsights = useMemo(() => {\n    const prices = sellableProducts.map(product => Number(product.preco) || 0);\n    return {\n      priceRange: prices.length > 0\n        ? `${formatCompactCurrency(Math.min(...prices))}–${formatCompactCurrency(Math.max(...prices))}`\n        : '—',\n      categoryCount: pdvCategories.length,\n      pausedCount: Math.max(0, dynamicMenu.length - sellableProducts.length),\n    };\n  }, [dynamicMenu.length, pdvCategories.length, sellableProducts]);\n""",
    """  const pdvMenuInsights = useMemo(() => {\n    const itemCount = pdvCart.reduce((total, item) => total + item.quantity, 0);\n    const cartTotal = pdvCart.reduce((total, item) => total + (item.product.preco * item.quantity), 0);\n    const destination = pdvOrderType === 'mesa'\n      ? (pdvTargetMesaId > 0 ? `Mesa ${pdvTargetMesaId}` : 'Escolher mesa')\n      : pdvOrderType === 'entrega'\n        ? 'Delivery'\n        : 'Retirada';\n    return {\n      destination,\n      itemCount,\n      total: formatCompactCurrency(cartTotal),\n      pausedCount: Math.max(0, dynamicMenu.length - sellableProducts.length),\n    };\n  }, [dynamicMenu.length, pdvCart, pdvOrderType, pdvTargetMesaId, sellableProducts.length]);\n""",
)
replace_once(
    CAIXA,
    """                description=\"Escolha os itens e o destino. Os detalhes aparecem só quando forem úteis.\"\n                metrics={[\n                  { label: 'faixa de preços', value: pdvMenuInsights.priceRange },\n                  { label: 'categorias ativas', value: pdvMenuInsights.categoryCount },\n                  {\n                    label: 'itens pausados',\n                    value: pdvMenuInsights.pausedCount,\n                    valueClassName: pdvMenuInsights.pausedCount > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300',\n                  },\n                ]}\n""",
    """                description=\"Clique para adicionar. Passe o mouse ou use o ícone de detalhes para conferir ingredientes.\"\n                metrics={pdvMenuInsights.pausedCount > 0 ? [\n                  { label: 'destino', value: pdvMenuInsights.destination },\n                  { label: 'itens', value: pdvMenuInsights.itemCount },\n                  { label: 'total', value: pdvMenuInsights.total },\n                  { label: 'pausados', value: pdvMenuInsights.pausedCount, valueClassName: 'text-amber-600 dark:text-amber-300' },\n                ] : [\n                  { label: 'destino', value: pdvMenuInsights.destination },\n                  { label: 'itens', value: pdvMenuInsights.itemCount },\n                  { label: 'total', value: pdvMenuInsights.total },\n                ]}\n""",
)

# 5) Checkout: item só é baixável quando realmente chegou ao estado pronto/entregue.
replace_once(
    CAIXA,
    """  // Checkout calculations helper\n  const getCheckoutTotals = (\n""",
    """  const isItemReadyForCheckout = (item: OrderItem) => (\n    item.status === 'pronto' || item.status === 'entregue'\n  );\n\n  // Checkout calculations helper\n  const getCheckoutTotals = (\n""",
)
replace_once(
    CAIXA,
    """      && !item.pago\n      && (item.status as string) !== 'cancelado'\n    );\n""",
    """      && !item.pago\n      && (item.status as string) !== 'cancelado'\n      && isItemReadyForCheckout(item)\n    );\n""",
)

# Abrir checkout de mesa já marca apenas os itens prontos, evitando cobrar item ainda em preparo por acidente.
replace_once(
    CAIXA,
    """                                  setSelectedOrder(checkoutOrder);\n                                  setShowCheckoutModal(true);\n                                  setCheckoutServiceTax(true);\n                                  setSplitPeople('1');\n                                  setSelectedItemIds([]);\n                                  setSmartPosRecoveryError('');\n                                  \n                                  const sub = checkoutOrder.itens\n                                    .filter(item => (item.status as string) !== 'cancelado')\n                                    .reduce((sum, item) => sum + item.preco, 0);\n                                  const total = sub * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0));\n                                  setPaymentValor(\n                                    Math.max(0, total - Number(checkoutOrder.valorPago || 0))\n                                  );\n""",
    """                                  const readyItemIds = checkoutOrder.itens\n                                    .filter(item => !item.pago && isItemReadyForCheckout(item))\n                                    .map(item => item.id);\n                                  setSelectedOrder(checkoutOrder);\n                                  setShowCheckoutModal(true);\n                                  setCheckoutServiceTax(true);\n                                  setSplitPeople('1');\n                                  setSelectedItemIds(readyItemIds);\n                                  setSmartPosRecoveryError('');\n                                  const readyTotal = readyItemIds.length > 0\n                                    ? getSelectedItemsTotal(checkoutOrder, readyItemIds, true)\n                                    : 0;\n                                  setPaymentValor(readyTotal > 0 ? readyTotal : '');\n""",
)

# Auto preenchimento também respeita a mesma regra quando o modal abre.
regex_once(
    CAIXA,
    r"  // Auto-initialize paymentValor with open balance when checkout modal opens\n  useEffect\(\(\) => \{\n    if \(showCheckoutModal && selectedOrder\) \{\n      if \(!paymentValor \|\| Number\(paymentValor \|\| 0\) <= 0\) \{\n        const balance = getCheckoutBalance\(selectedOrder\);\n        if \(balance > 0\) \{\n          setPaymentValor\(balance\);\n        \}\n      \}\n    \} else if \(!showCheckoutModal\) \{",
    """  // Auto-initialize paymentValor when checkout modal opens. Mesas priorizam itens prontos;\n  // sem itens prontos, o operador precisa optar conscientemente por um adiantamento.\n  useEffect(() => {\n    if (showCheckoutModal && selectedOrder) {\n      if (!paymentValor || Number(paymentValor || 0) <= 0) {\n        const readyItemIds = selectedOrder.itens\n          .filter(item => !item.pago && isItemReadyForCheckout(item))\n          .map(item => item.id);\n        const balance = isTableCheckoutOrder(selectedOrder)\n          ? (readyItemIds.length > 0 ? getSelectedItemsTotal(selectedOrder, readyItemIds) : 0)\n          : getCheckoutBalance(selectedOrder);\n        if (balance > 0) {\n          setPaymentValor(balance);\n        }\n      }\n    } else if (!showCheckoutModal) {""",
)

replace_once(
    CAIXA,
    """                        Marque itens para pagá-los juntos ou deixe tudo desmarcado para receber qualquer valor.\n""",
    """                        Itens prontos já podem ser recebidos. Itens em preparo ficam visíveis, mas bloqueados até avançarem na cozinha.\n""",
)
replace_once(
    CAIXA,
    """                      const isPaid = item.pago;\n                      const isCancelled = (item.status as string) === 'cancelado';\n                      const canSelect = !isPaid && !isCancelled;\n""",
    """                      const isPaid = item.pago;\n                      const isCancelled = (item.status as string) === 'cancelado';\n                      const isReadyForCheckout = isItemReadyForCheckout(item);\n                      const canSelect = !isPaid && !isCancelled && isReadyForCheckout;\n""",
)
replace_once(
    CAIXA,
    """                            : isPaid\n                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'\n                            : selectedItemIds.includes(item.id)\n                              ? 'bg-emerald-500/15 border-emerald-500/30 cursor-pointer shadow-inner'\n                              : 'bg-koma-card/60 border-koma-border/50 hover:border-koma-border cursor-pointer'\n""",
    """                            : isPaid\n                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'\n                            : !isReadyForCheckout\n                              ? 'bg-amber-500/5 border-amber-500/15 text-koma-secondary cursor-not-allowed opacity-80'\n                              : selectedItemIds.includes(item.id)\n                                ? 'bg-emerald-500/15 border-emerald-500/30 cursor-pointer shadow-inner'\n                                : 'bg-koma-card/60 border-koma-border/50 hover:border-koma-border cursor-pointer'\n""",
)
replace_once(
    CAIXA,
    """                              <span className={clsx('text-[9px]', 'text-koma-subtle', 'block')}>Cliente: {item.clienteNome}</span>\n""",
    """                              <span className={clsx('text-[9px]', 'text-koma-subtle', 'block')}>Cliente: {item.clienteNome}</span>\n                              {!isPaid && !isCancelled && !isReadyForCheckout && (\n                                <span className={clsx('text-[8px]', 'font-semibold', 'text-amber-600', 'dark:text-amber-300', 'block')}>\n                                  Em preparo · avance na cozinha antes de baixar este item\n                                </span>\n                              )}\n""",
)
replace_once(
    CAIXA,
    """                            {isCancelled && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-rose-500', 'font-sans', 'mt-0.5')}>Cancelado</span>}\n""",
    """                            {isCancelled && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-rose-500', 'font-sans', 'mt-0.5')}>Cancelado</span>}\n                            {!isPaid && !isCancelled && !isReadyForCheckout && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-amber-600', 'dark:text-amber-300', 'font-sans', 'mt-0.5')}>Em preparo</span>}\n""",
)

# Sair de seleção de itens vira um adiantamento explícito, sem preencher o saldo inteiro sozinho.
replace_once(
    CAIXA,
    """                          onClick={() => {\n                            if (selectedOrder) {\n                              setSelectedItemIds([]);\n                              setSplitPeople('1');\n                              setPaymentValor(getCheckoutBalance(selectedOrder));\n                            }\n                          }}\n""",
    """                          onClick={() => {\n                            if (!selectedOrder) return;\n                            setSplitPeople('1');\n                            if (selectedItemIds.length > 0) {\n                              setSelectedItemIds([]);\n                              setPaymentValor('');\n                            } else {\n                              setPaymentValor(getCheckoutBalance(selectedOrder));\n                            }\n                          }}\n""",
)
replace_once(
    CAIXA,
    """                          {selectedItemIds.length > 0 ? 'Usar Saldo Total' : 'Pagar Valor Exato'}\n""",
    """                          {selectedItemIds.length > 0 ? 'Adiantar outro valor' : 'Usar saldo total'}\n""",
)
replace_once(
    CAIXA,
    """                        <strong>Dica:</strong> {selectedItemIds.length > 0\n                          ? 'Os itens marcados serão baixados juntos. Use “Usar Saldo Total” ou desmarque-os para lançar um valor livre.'\n                          : isTableCheckoutOrder(selectedOrder)\n                            ? 'Sem itens marcados, qualquer baixa abate o saldo geral da mesa. Você pode receber uma parte no Pix e o restante no cartão.'\n                            : 'Para pagamentos múltiplos, digite qualquer valor e faça as baixas em sequência.'}\n""",
    """                        <strong>Dica:</strong> {selectedItemIds.length > 0\n                          ? 'Os itens prontos marcados serão baixados juntos. “Adiantar outro valor” limpa a seleção e libera um valor manual.'\n                          : isTableCheckoutOrder(selectedOrder)\n                            ? 'Sem itens marcados, o lançamento é um adiantamento sobre o saldo geral da mesa; itens em preparo continuam sem baixa individual.'\n                            : 'Para pagamentos múltiplos, digite qualquer valor e faça as baixas em sequência.'}\n""",
)
replace_once(
    CAIXA,
    """                          onClick={() => {\n                            setSelectedItemIds([]);\n                            setSplitPeople('1');\n                            setPaymentValor(getCheckoutBalance(selectedOrder));\n                          }}\n""",
    """                          onClick={() => {\n                            setSelectedItemIds([]);\n                            setSplitPeople('1');\n                            setPaymentValor('');\n                          }}\n""",
)
replace_once(
    CAIXA,
    """                          Limpar\n""",
    """                          Outro valor\n""",
)
replace_once(
    CAIXA,
    """                          ? 'Receber Itens Selecionados'\n                          : 'Lançar Pagamento / Baixa'}\n""",
    """                          ? 'Receber itens prontos'\n                          : 'Registrar adiantamento'}\n""",
)

# 6) Backend: item_ids nunca pode dar baixa individual em item ainda em preparo.
replace_once(
    BACKEND_CAIXA,
    """            if item.status != \"cancelado\" and not item.pago\n""",
    """            if item.status in {\"pronto\", \"entregue\"} and not item.pago\n""",
)
replace_once(
    BACKEND_CAIXA,
    """                    \"Um ou mais itens selecionados não pertencem à mesa, \"\n                    \"foram cancelados ou já estão pagos.\"\n""",
    """                    \"Um ou mais itens selecionados não pertencem à mesa, \"\n                    \"ainda estão em preparo, foram cancelados ou já estão pagos.\"\n""",
)
replace_once(
    BACKEND_CAIXA,
    """                Item.status != 'cancelado',\n                Item.pago == False\n""",
    """                Item.status.in_((\"pronto\", \"entregue\")),\n                Item.pago == False\n""",
)
replace_once(
    BACKEND_CAIXA,
    """                    detail=\"Nenhum item válido pendente de pagamento foi selecionado.\"\n""",
    """                    detail=\"Nenhum item pronto e pendente de pagamento foi selecionado.\"\n""",
)

# 7) Devolução rápida: endpoint contextual de um único pagamento.
insert_after = """@legacy_cash.router.get(\"/pagamentos/estornaveis\")\ndef listar_pagamentos_estornaveis(\n    limite: int = Query(50, ge=1, le=100),\n    db: Session = Depends(get_db),\n    current_user: Usuario = Depends(require_permission(\"caixa:operar\")),\n):\n    rest_id = require_tenant_id()\n    payments = db.query(Pagamento).filter(\n        Pagamento.restaurante_id == rest_id,\n        Pagamento.status == \"aprovado\",\n    ).order_by(Pagamento.criado_em.desc(), Pagamento.id.desc()).limit(limite * 2).all()\n    result = []\n    for payment in payments:\n        payload = _refundable_payment_payload(db, rest_id, payment)\n        if payload[\"saldo_estornavel\"] > 0:\n            result.append(payload)\n        if len(result) >= limite:\n            break\n    return result\n\n\n"""
new_block = insert_after + """@legacy_cash.router.get(\"/pagamentos/{pagamento_id}/estornavel\")\ndef obter_pagamento_estornavel(\n    pagamento_id: str,\n    db: Session = Depends(get_db),\n    current_user: Usuario = Depends(require_permission(\"caixa:operar\")),\n):\n    \"\"\"Carrega um único recebimento para abertura imediata da devolução contextual.\"\"\"\n    rest_id = require_tenant_id()\n    payment = db.query(Pagamento).filter(\n        Pagamento.restaurante_id == rest_id,\n        Pagamento.id == pagamento_id,\n        Pagamento.status == \"aprovado\",\n    ).first()\n    if payment is None:\n        raise HTTPException(status_code=404, detail=\"Pagamento não encontrado.\")\n    payload = _refundable_payment_payload(db, rest_id, payment)\n    if payload[\"saldo_estornavel\"] <= 0:\n        raise HTTPException(status_code=409, detail=\"Este pagamento não possui valor disponível para devolução.\")\n    return payload\n\n\n"""
replace_once(FINANCIAL_CASH, insert_after, new_block)

# 8) Serviço frontend: chamada contextual + cache curto e lista menor sob demanda.
replace_once(
    SERVICE,
    """export const listarPagamentosEstornaveis = async (): Promise<RefundablePayment[]> => {\n  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/estornaveis?limite=50`, {\n    headers: getAuthHeaders(),\n  });\n  if (!res.ok) {\n    const errData = await res.json().catch(() => ({}));\n    throw new Error(errData.detail || 'Falha ao carregar pagamentos estornáveis.');\n  }\n  return res.json();\n};\n\n""",
    """const refundablePaymentCache = new Map<string, { expiresAt: number; payment: RefundablePayment }>();\n\nexport const obterPagamentoEstornavel = async (pagamentoId: string, force = false): Promise<RefundablePayment> => {\n  const key = String(pagamentoId);\n  const cached = refundablePaymentCache.get(key);\n  if (!force && cached && cached.expiresAt > Date.now()) return cached.payment;\n\n  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/${encodeURIComponent(key)}/estornavel`, {\n    headers: getAuthHeaders(),\n  });\n  if (!res.ok) {\n    const errData = await res.json().catch(() => ({}));\n    throw new Error(errData.detail || 'Falha ao carregar o pagamento.');\n  }\n  const payment: RefundablePayment = await res.json();\n  refundablePaymentCache.set(key, { expiresAt: Date.now() + 15_000, payment });\n  return payment;\n};\n\nexport const listarPagamentosEstornaveis = async (limite = 25): Promise<RefundablePayment[]> => {\n  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limite) || 25));\n  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/estornaveis?limite=${safeLimit}`, {\n    headers: getAuthHeaders(),\n  });\n  if (!res.ok) {\n    const errData = await res.json().catch(() => ({}));\n    throw new Error(errData.detail || 'Falha ao carregar pagamentos estornáveis.');\n  }\n  const payments: RefundablePayment[] = await res.json();\n  const expiresAt = Date.now() + 15_000;\n  payments.forEach(payment => refundablePaymentCache.set(payment.id, { expiresAt, payment }));\n  return payments;\n};\n\n""",
)
replace_once(
    SERVICE,
    """  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/${encodeURIComponent(pagamentoId)}/estornar`, {\n""",
    """  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/${encodeURIComponent(pagamentoId)}/estornar`, {\n""",
)
replace_once(
    SERVICE,
    """  if (!res.ok) {\n    const errData = await res.json().catch(() => ({}));\n    throw new Error(errData.detail || 'Falha ao registrar estorno.');\n  }\n  return res.json();\n};\n\nexport const API = {\n""",
    """  if (!res.ok) {\n    const errData = await res.json().catch(() => ({}));\n    throw new Error(errData.detail || 'Falha ao registrar estorno.');\n  }\n  refundablePaymentCache.delete(String(pagamentoId));\n  return res.json();\n};\n\nexport const API = {\n""",
)
replace_once(
    SERVICE,
    """  listarPagamentosEstornaveis,\n  estornarPagamento,\n""",
    """  obterPagamentoEstornavel,\n  listarPagamentosEstornaveis,\n  estornarPagamento,\n""",
)

# 9) Modal: abre com o pagamento clicado primeiro; lista completa vem em background.
replace_once(
    REFUND_MODAL,
    """  estornarPagamento,\n  listarPagamentosEstornaveis,\n""",
    """  estornarPagamento,\n  listarPagamentosEstornaveis,\n  obterPagamentoEstornavel,\n""",
)
replace_once(
    REFUND_MODAL,
    """  const load = async () => {\n    setLoading(true);\n    setError(null);\n    try {\n      const data = await listarPagamentosEstornaveis();\n      setPayments(data);\n      if (initialPaymentId && data.some(payment => payment.id === initialPaymentId)) {\n        setSelectedId(initialPaymentId);\n      } else if (selectedId && !data.some(payment => payment.id === selectedId)) {\n        setSelectedId('');\n      }\n    } catch (err) {\n      setError(err instanceof Error ? err.message : 'Falha ao carregar pagamentos.');\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  useEffect(() => {\n    void load();\n  }, []);\n""",
    """  const mergePayments = (items: RefundablePayment[]) => {\n    setPayments(current => {\n      const map = new Map(current.map(payment => [payment.id, payment]));\n      items.forEach(payment => map.set(payment.id, payment));\n      return Array.from(map.values()).sort((a, b) => (\n        new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime()\n      ));\n    });\n  };\n\n  const load = async (background = false) => {\n    if (!background) setLoading(true);\n    if (!background) setError(null);\n    try {\n      const data = await listarPagamentosEstornaveis(25);\n      if (background) mergePayments(data);\n      else setPayments(data);\n      if (!initialPaymentId && selectedId && !data.some(payment => payment.id === selectedId)) {\n        setSelectedId('');\n      }\n    } catch (err) {\n      if (!background) setError(err instanceof Error ? err.message : 'Falha ao carregar pagamentos.');\n    } finally {\n      if (!background) setLoading(false);\n    }\n  };\n\n  useEffect(() => {\n    let cancelled = false;\n    const bootstrap = async () => {\n      if (!initialPaymentId) {\n        await load();\n        return;\n      }\n      setLoading(true);\n      setError(null);\n      try {\n        const payment = await obterPagamentoEstornavel(initialPaymentId);\n        if (cancelled) return;\n        setPayments([payment]);\n        setSelectedId(payment.id);\n        setLoading(false);\n        void load(true);\n      } catch (err) {\n        if (cancelled) return;\n        await load();\n      }\n    };\n    void bootstrap();\n    return () => { cancelled = true; };\n  }, []);\n""",
)

print("manual-test fixes applied")
