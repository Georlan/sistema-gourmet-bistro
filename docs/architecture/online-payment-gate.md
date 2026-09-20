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

## Fechamento do Caixa e Pix assíncrono

O Pix online pertence ao turno de Caixa em que a intenção foi criada. Esse vínculo é histórico: `OnlinePaymentIntent.turno_id` não é transferido para um turno posterior.

O QR Code mantém **30 minutos** de validade no Mercado Pago (mínimo aceito pela integração atual). Separadamente, o KÔMA usa uma **janela operacional de 5 minutos** para fechamento: depois dela, uma tentativa de fechar o turno consulta a verdade do provedor e pode cancelar explicitamente um Pix que continue pendente.

- `approved`: materializa exatamente um `Pagamento(status="aprovado")` no mesmo `turno_id`; o pedido continua válido e o turno não fecha enquanto a comanda permanecer aberta.
- `created/pending/error` ainda dentro da janela operacional de 5 minutos: o fechamento é bloqueado.
- pendente após a janela operacional: o backend tenta cancelar no Mercado Pago; somente uma resposta autoritativa terminal libera o pedido como abandonado.
- `rejected/cancelled/expired`: o pedido ainda não publicado é encerrado como inválido, seus itens são cancelados e ele deixa de bloquear o Caixa.
- estado incerto, indisponibilidade do provedor ou divergência financeira: o fechamento falha fechado.

A corrida aprovação × cancelamento é resolvida pela fonte de verdade do provedor. Se a aprovação vencer, o recebimento é materializado no turno original e o fechamento é interrompido. Se o cancelamento vencer, nenhum `Pagamento` é criado.

Invariante financeira do fechamento:

`turno fechado => não existe OnlinePaymentIntent financeiramente indefinida originada no turno`.

Para toda intenção aprovada:

`OnlinePaymentIntent.status == approved => existe exatamente um Pagamento aprovado, com mesmo valor e mesmo turno_id`.

Nenhum caminho normal pode reconhecer uma aprovação tardia em outro turno.

## Autoridade dos termos comerciais e taxa KÔMA

O catálogo em `backend/app/subscription.py` descreve a oferta vigente para **novas contratações**. Ele não é a autoridade financeira de um tenant que já possui aceite.

Para um tenant contratado, o backend resolve o `ContractAcceptance` mais recente vinculado ao restaurante e lê do comprovante assinado o snapshot comercial, incluindo `plan`, `fixedMonthlyPrice`, `billingAmount`, `marketplaceRate` e versão jurídica. Em PostgreSQL essa leitura usa a função tenant-scoped `koma_internal.current_contract_receipt()`; o runtime não recebe leitura direta irrestrita da tabela global de evidências.

Se um tenant realmente legado ainda não possuir `ContractAcceptance` vinculado **e** estiver marcado com `billing_mode=legacy`, o split usa o snapshot legado congelado `LEGACY_V25_MARKETPLACE_RATES`. Esse fallback não acompanha mudanças futuras do catálogo público.

Um tenant com `billing_mode=subscription` sem aceite comercial vinculado **não** recebe o fallback legado: o cálculo falha fechado. Isso impede que um tenant novo provisionado administrativamente herde 1,49%/0,69%/0,29% por acidente só porque ainda não possui contrato.

A ordem de autoridade é:

`tenant -> último aceite comercial vinculado -> marketplaceRate contratada -> OnlinePaymentIntent.marketplace_fee -> Mercado Pago application_fee`.

O resolvedor canônico `tenant_marketplace_rate(...)` deve ser usado por qualquer cálculo financeiro tenant-scoped que dependa da taxa KÔMA, inclusive simuladores de margem/fidelidade. `restaurante.plano` identifica o perfil de recursos/entitlements; ele não é autoridade para preço ou taxa de um tenant contratado. Alterar somente esse campo não pode alterar o split.

Quando existe mais de um aceite histórico vinculado ao mesmo tenant, a autoridade vigente é escolhida deterministicamente. No PostgreSQL, a ordem é `linked_at DESC, accepted_at DESC, link.id DESC`; no fallback SQLite de testes, `linked_at DESC, link.id DESC`. Os aceites anteriores permanecem imutáveis e auditáveis.

A trava `ONLINE_PAYMENT_PLAN_FEES_ENABLED=false` prevalece sobre qualquer taxa contratada e materializa `0.00`. Quando habilitada, a taxa resolvida é calculada e gravada na `OnlinePaymentIntent` no momento da criação do pagamento. O provider usa esse valor materializado; mudanças comerciais posteriores não alteram retroativamente uma intenção já criada.

Planos legados (`bistro`, `delivery`, `gold`, `platinum`) continuam normalizados como Premium somente no fallback legado. O override de homologação `KOMA_TEST_PREMIUM_RESTAURANTE_IDS` continua limitado a recursos e não muda a taxa financeira.

A edição genérica do Super Admin não pode trocar `restaurante.plano` isoladamente. Mudanças reais de plano devem passar por um fluxo canônico que coordene novo aceite/termos, billing SaaS, provider, taxa transacional, entitlements e auditoria antes de confirmar a alteração.

No estado atual, a aba **Planos & Upgrade** é somente um canal de contato e não executa mudança de plano. Enquanto a orquestração canônica de mudança de plano não existir, qualquer tentativa administrativa de trocar apenas o slug/plano de recursos deve permanecer bloqueada. Isso evita divergência entre recursos, cobrança fixa, autorização do provider e split.

Uma mudança canônica futura só poderá tornar o novo aceite a autoridade depois que a transição de billing/provider estiver em estado seguro. Intenções de pagamento online já criadas nunca são recalculadas; apenas novas intenções passam a usar a nova `marketplaceRate`.

## Configuração para ativar

O deploy precisa definir:

- `KOMA_PUBLIC_API_URL`: origem HTTPS pública do backend.
- `ONLINE_PAYMENT_PLAN_FEES_ENABLED`: `false` por padrão. Somente `true` autoriza o backend a calcular e enviar a taxa comercial resolvida do contrato do tenant ao provedor.
- `ONLINE_PAYMENT_PIX_EXPIRATION_MINUTES`: validade do Pix no provedor; mínimo de 30 minutos na integração atual.
- `ONLINE_PAYMENT_PIX_CLOSE_GRACE_MINUTES`: janela operacional antes de o fechamento poder cancelar um Pix ainda pendente; padrão de 5 minutos.

A trava existe para impedir que um merge de código passe a cobrar comissão em produção sem decisão operacional explícita. Antes de habilitar, validar contrato, documentação fiscal, fluxo OAuth/marketplace, credenciais do provedor, reembolso, chargeback e conciliação.

Cada restaurante precisa de uma linha ativa em `restaurant_payment_accounts`, criada pelo fluxo OAuth do marketplace. Access token, refresh token e segredo do webhook são criptografados em repouso. O cardápio só oferece Pix quando essa conta está ativa.

O fluxo OAuth e a cobrança real já foram homologados em produção com tenant separado, Pix aprovado, webhook assinado, idempotência e `application_fee`. Nenhum segredo deve ser digitado ou armazenado no frontend.
