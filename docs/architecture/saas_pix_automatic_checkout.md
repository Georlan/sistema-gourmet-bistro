# Checkout SaaS: três meios finais

O checkout público de novas assinaturas KÔMA publica exatamente três meios:

1. `credit_card` — cartão de crédito recorrente.
2. `pix` — cobrança Pix universal por QR Code e Pix Copia e Cola, pagável em qualquer banco/PSP participante do Pix.
3. `account_money` — Saldo Mercado Pago recorrente.

Todos preservam a mesma regra comercial: R$ 0 de mensalidade fixa hoje, implantação essencial sem consumir trial e 7 dias grátis completos antes da primeira cobrança.

O Pix do checkout não usa `preapproval_plan` e não depende do saldo Mercado Pago. O aceite apenas seleciona `pix`; a cobrança é criada via `/v1/payments` quando houver valor efetivamente devido após o trial. A resposta do provedor fornece `qr_code`, `qr_code_base64` e `ticket_url`, que o KÔMA pode renderizar diretamente.

## Pix mensal x anual

- **Mensal:** após o trial, cada vencimento gera um novo QR Code/Pix Copia e Cola no valor mensal do plano. O pagamento confirmado avança o período pago em 1 mês.
- **Anual:** após o trial, é gerado um único QR Code/Pix Copia e Cola no valor anual com 10% de desconto. O pagamento confirmado quita 12 meses; nenhum novo QR deve ser gerado dentro desse período pago.
- Em ambos os casos o QR é Pix comum interoperável e não cria autorização de débito automático para o período seguinte.

`pix_automatic` permanece apenas como compatibilidade para tentativas históricas e não deve ser apresentado como Pix universal enquanto o provedor não expuser uma API pública de autorização recorrente interoperável por QR Code.

> O nome deste arquivo é histórico; o fluxo canônico atual é Pix universal, não Pix Automático.
