# Barreira de pagamento online

O KÔMA separa a criação técnica do pedido da sua liberação operacional.

## Regra de entrada

- `dinheiro` com `forma_pagamento=na_entrega`: o pedido é publicado imediatamente para Caixa/cozinha.
- `pix` com `forma_pagamento=online`: a comanda nasce com `online_payment_status=pending`, sem evento operacional e fora das consultas usadas pelo Caixa, KDS e SmartPOS.
- cartão online permanece indisponível até existir tokenização por componente seguro do provedor.

## Confirmação

1. O backend calcula o total, fixa o turno aberto e grava pedido + intenção na mesma transação.
2. O adaptador cria o Pix com chave idempotente no Mercado Pago.
3. O webhook valida a assinatura e busca o pagamento diretamente na API do Mercado Pago. O corpo recebido não decide valor nem status.
4. O backend confere `external_reference` e valor.
5. Somente `approved` cria `Pagamento`, marca os itens como pagos, muda a barreira para `approved` e publica `OrderCreated`.
6. Repetições de webhook e reconciliação são idempotentes.

## Configuração para ativar

O deploy precisa definir:

- `KOMA_PUBLIC_API_URL`: origem HTTPS pública do backend.
- `ONLINE_PAYMENT_MARKETPLACE_RATE`: `0` enquanto não houver cobrança da plataforma; `0.008`, por exemplo, representa 0,8%.
- `ONLINE_PAYMENT_PIX_EXPIRATION_MINUTES`: validade do Pix.

Cada restaurante precisa de uma linha ativa em `restaurant_payment_accounts`, criada pelo futuro fluxo OAuth do marketplace. Access token, refresh token e segredo do webhook são criptografados em repouso. O cardápio só oferece Pix quando essa conta está ativa.

Ainda é necessário implementar a tela/fluxo OAuth “Conectar Mercado Pago” e executar homologação com credenciais de teste antes da ativação comercial. Nenhum segredo deve ser digitado ou armazenado no frontend.
