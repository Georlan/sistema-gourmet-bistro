# Barreira de pagamento online

O KÔMA separa a criação técnica do pedido da sua liberação operacional.

## Regra de entrada

- `dinheiro` com `forma_pagamento=na_entrega`: o pedido é publicado imediatamente para Caixa/cozinha.
- `pix` com `forma_pagamento=online`: a comanda nasce com `online_payment_status=pending`, sem evento operacional e fora das consultas usadas pelo Caixa, KDS e SmartPOS.
- cartão online permanece indisponível até existir tokenização por componente seguro do provedor.

## Confirmação

1. O backend calcula o total, fixa o turno aberto e grava pedido + intenção na mesma transação.
2. O backend resolve os termos comerciais contratados do tenant e calcula a comissão KÔMA daquele pedido.
3. O adaptador cria o Pix com chave idempotente no Mercado Pago e envia a comissão como `application_fee` quando a cobrança por plano estiver habilitada.
4. O webhook valida a assinatura e busca o pagamento diretamente na API do Mercado Pago. O corpo recebido não decide valor nem status.
5. O backend confere `external_reference` e valor.
6. Somente `approved` cria `Pagamento`, marca os itens como pagos, muda a barreira para `approved` e publica `OrderCreated`.
7. Repetições de webhook e reconciliação são idempotentes.

## Autoridade dos termos comerciais e taxa KÔMA

O catálogo em `backend/app/subscription.py` descreve a oferta vigente para **novas contratações**. Ele não é a autoridade financeira de um tenant que já possui aceite.

Para um tenant contratado, o backend resolve o `ContractAcceptance` mais recente vinculado ao restaurante e lê do comprovante assinado o snapshot comercial, incluindo `plan`, `fixedMonthlyPrice`, `billingAmount`, `marketplaceRate` e versão jurídica. Em PostgreSQL essa leitura usa a função tenant-scoped `koma_internal.current_contract_receipt()`; o runtime não recebe leitura direta irrestrita da tabela global de evidências.

Se um tenant legado ainda não possuir `ContractAcceptance` vinculado, o split usa o snapshot legado congelado `LEGACY_V25_MARKETPLACE_RATES`. Esse fallback não acompanha mudanças futuras do catálogo público. Portanto, alterar Pocket de 1,49% para uma nova taxa em uma versão comercial futura não altera automaticamente um Pocket legado.

A ordem de autoridade é:

`tenant -> último aceite comercial vinculado -> marketplaceRate contratada -> OnlinePaymentIntent.marketplace_fee -> Mercado Pago application_fee`.

A trava `ONLINE_PAYMENT_PLAN_FEES_ENABLED=false` prevalece sobre qualquer taxa contratada e materializa `0.00`. Quando habilitada, a taxa resolvida é calculada e gravada na `OnlinePaymentIntent` no momento da criação do pagamento. O provider usa esse valor materializado; mudanças comerciais posteriores não alteram retroativamente uma intenção já criada.

Planos legados (`bistro`, `delivery`, `gold`, `platinum`) continuam normalizados como Premium somente no fallback legado. O override de homologação `KOMA_TEST_PREMIUM_RESTAURANTE_IDS` continua limitado a recursos e não muda a taxa financeira.

A edição genérica do Super Admin não pode trocar `restaurante.plano` isoladamente. Mudanças reais de plano devem passar por um fluxo canônico que coordene novo aceite/termos, billing SaaS, provider, taxa transacional, entitlements e auditoria antes de confirmar a alteração.

## Configuração para ativar

O deploy precisa definir:

- `KOMA_PUBLIC_API_URL`: origem HTTPS pública do backend.
- `ONLINE_PAYMENT_PLAN_FEES_ENABLED`: `false` por padrão. Somente `true` autoriza o backend a calcular e enviar as taxas por plano ao provedor.
- `ONLINE_PAYMENT_PIX_EXPIRATION_MINUTES`: validade do Pix.

A trava existe para impedir que um merge de código passe a cobrar comissão em produção sem decisão operacional explícita. Antes de habilitar, validar contrato, documentação fiscal, fluxo OAuth/marketplace, credenciais do provedor, reembolso, chargeback e conciliação.

Cada restaurante precisa de uma linha ativa em `restaurant_payment_accounts`, criada pelo fluxo OAuth do marketplace. Access token, refresh token e segredo do webhook são criptografados em repouso. O cardápio só oferece Pix quando essa conta está ativa.

O fluxo OAuth e a cobrança real já foram homologados em produção com tenant separado, Pix aprovado, webhook assinado, idempotência e `application_fee`. Nenhum segredo deve ser digitado ou armazenado no frontend.
