# Checkout SaaS: três meios finais

O checkout público de novas assinaturas KÔMA publica exatamente três meios:

1. `credit_card` — cartão de crédito recorrente.
2. `pix_automatic` — Pix Automático recorrente, autorizado no ambiente seguro do provedor.
3. `account_money` — Saldo Mercado Pago recorrente.

Todos preservam a mesma regra comercial: R$ 0 de mensalidade fixa hoje, implantação essencial sem consumir trial e 7 dias grátis completos antes da primeira cobrança recorrente.

O Pix avulso (`pix`) por QR Code/Copia e Cola permanece apenas como trilho técnico/fallback para cobranças pontuais e não deve ser apresentado como substituto de Pix Automático no checkout de novas assinaturas.

Para `pix_automatic`, o KÔMA usa o fluxo recorrente existente do Mercado Pago e somente considera a autorização válida após confirmar `payment_method_id=pix`, valor, moeda, referência contratual e trial. O teste manual obrigatório deve validar a experiência real de autorização e, quando possível, um banco/PSP externo ao Mercado Pago antes de considerar a jornada interoperável homologada.
