# Barreira de pagamento online

O KÔMA separa a criação técnica do pedido da sua liberação operacional.

## Regra de entrada

- `dinheiro` com `forma_pagamento=na_entrega`: o pedido é publicado imediatamente para Caixa/cozinha.
- `pix` com `forma_pagamento=online`: a comanda nasce com `online_payment_status=pending`, sem evento operacional e fora das consultas usadas pelo Caixa, KDS e SmartPOS.
- cartão online permanece indisponível até existir tokenização por componente seguro do provedor.

## Confirmação

1. O backend calcula o total, fixa o turno aberto e grava pedido + intenção na mesma transação.
2. O backend lê o plano contratado do restaurante e calcula a comissão KÔMA daquele pedido.
3. O adaptador cria o Pix com chave idempotente no Mercado Pago e envia a comissão como `application_fee` quando a cobrança por plano estiver habilitada.
4. O webhook valida a assinatura e busca o pagamento diretamente na API do Mercado Pago. O corpo recebido não decide valor nem status.
5. O backend confere `external_reference` e valor.
6. Somente `approved` cria `Pagamento`, marca os itens como pagos, muda a barreira para `approved` e publica `OrderCreated`.
7. Repetições de webhook e reconciliação são idempotentes.

## Taxa KÔMA por plano

A fonte de verdade financeira fica em `backend/app/subscription.py`:

- Pocket: `0.0149` = 1,49% por pedido online pago.
- Pro: `0.0069` = 0,69% por pedido online pago.
- Premium: `0.0029` = 0,29% por pedido online pago.

O valor da comissão é calculado e gravado na `OnlinePaymentIntent` no momento da criação do pagamento. Assim, uma mudança posterior de plano não altera retroativamente uma intenção já criada.

Planos legados (`bistro`, `delivery`, `gold`, `platinum`) continuam normalizados como Premium. O override de homologação `KOMA_TEST_PREMIUM_RESTAURANTE_IDS` libera funcionalidades Premium para teste, mas não deve mudar a taxa financeira: a comissão usa o plano efetivamente salvo/contratado.

## Configuração para ativar

O deploy precisa definir:

- `KOMA_PUBLIC_API_URL`: origem HTTPS pública do backend.
- `ONLINE_PAYMENT_PLAN_FEES_ENABLED`: `false` por padrão. Somente `true` autoriza o backend a calcular e enviar as taxas por plano ao provedor.
- `ONLINE_PAYMENT_PIX_EXPIRATION_MINUTES`: validade do Pix.

A trava existe para impedir que um merge de código passe a cobrar comissão em produção sem decisão operacional explícita. Antes de habilitar, validar contrato, documentação fiscal, fluxo OAuth/marketplace, credenciais do provedor, reembolso, chargeback e conciliação.

Cada restaurante precisa de uma linha ativa em `restaurant_payment_accounts`, criada pelo fluxo OAuth do marketplace. Access token, refresh token e segredo do webhook são criptografados em repouso. O cardápio só oferece Pix quando essa conta está ativa.

Ainda é necessário concluir/homologar a tela e o fluxo OAuth “Conectar Mercado Pago” com credenciais de teste antes da ativação comercial. Nenhum segredo deve ser digitado ou armazenado no frontend.
