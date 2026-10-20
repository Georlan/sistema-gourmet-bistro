# Pagamentos e diagnóstico — revisão em 20/10/2026

Base: `main` b340e809f53e0d0dd266a5b95577d290f6acc6cb. Portados os deltas úteis de #1144, #1129, #1130 e #1176 sobre essa base. Sem migration, ativação de PagBank, alteração de preço/trial ou configuração de tenants. #1012 (área de entrega) fica fora por solicitação do usuário.

## Produção observada antes da mudança

- Frontend `b340e809f53e`; API `20f3826767f2dd2602c50d50292dc854c87198e0`. SHAs diferentes são esperados em publicação somente frontend.
- Smoke público de produção passou; Railway Kôma online, uma réplica, nenhuma falha nas últimas oito horas.
- `/api/contracts/payment-methods-v2` anuncia cartão e Pix; produção, `providerAuthReady=true`, sete dias grátis e `upfrontPaymentAllowed=false`. Isso é capacidade declarada, não homologação financeira.
- Adesão Pix seleciona o método sem emitir cobrança; trial inicia após implantação essencial. Cartão autoriza a recorrência. Pix é gerado no vencimento. Preservada essa política comercial; pagamento imediato na inscrição exigiria alterar explicitamente o contrato e o trial.
- Railway informa nomes das variáveis, sem seus valores: token SaaS, chave pública, segredo webhook, aplicação e recebedor esperados estão presentes. O par `KOMA_SAAS_MERCADO_PAGO_CLIENT_ID/SECRET` está ausente. OAuth legado existe. Não é possível atestar correspondência de app/recebedor com valores redigidos.
- PostHog: projeto KÔMA Production 648305, America/Fortaleza. Consulta em janela móvel de sete dias retornou quatro `public_menu_viewed`; em 24 horas, um. Sem navegação/API/ações operacionais publicadas. Ausência de evento não comprova ausência de uso nem de erro.
- Aviso ativo PostHog: Authorized URLs vazio. Alterar `app_urls` exige confirmação dos domínios; proposta para conferência: `https://app.komafood.com.br`, `https://central.komafood.com.br`, `https://komafood.com.br`. Não usar hosts enviados por eventos como prova de propriedade. Nenhuma configuração PostHog alterada nesta revisão.

## Correções sobre a main

- Acompanhamento não cancela pedido de provedor externo pelo relógio do QR; aguarda estado financeiro, sem liberar pedido não aprovado. Compatibilidade com provedores já existentes preservada sem ativar novos.
- SaaS valida aplicação OAuth também no fallback, recebedor do token e identidade nas consultas de pagamento antes de conciliar. Capacidade pública falha fechada diante de identidade incompatível.
- Reemissão Pix mantém a tentativa em `pending/in_process/authorized` mesmo com QR vencido; falha de consulta e estado desconhecido bloqueiam nova cobrança. Status terminal do provedor permite nova tentativa; pagamento do ciclo anterior já conciliado não bloqueia a mensalidade seguinte. Chave de idempotência é estável inclusive na virada do dia e muda por tentativa/vencimento.
- PostHog recebe navegação explícita, ações de menu/adesão e sinais de erro/lentidão de API com endpoint sanitizado, build e request ID válido. Sem corpos, dados de cartão, PII de formulário, autocapture indiscriminado ou replay. Limite de sinais não representa tráfego total.
- Mensagem pública de indisponibilidade preserva a inscrição sem exibir configuração interna nem afirmar erroneamente que produção é homologação.

## Verificação e liberação

Validar typecheck, unidades frontend, build, regressões backend (inclusive suíte completa) e browser para cartão/Pix nos planos e ciclos, indisponibilidade, contratos históricos e aprovação de pedido após pausa. CI deve rodar no SHA final e com a base atualizada.

Após autorização de merge e checks verdes, conferir SHAs servidos e ingestão passiva dos novos eventos. Não gerar pedido, pagamento, impressão ou mensagem no tenant 6.

Para fechar homologação financeira, confirmar manualmente aplicação KomaBilling e recebedor esperado, configurar par dedicado quando diferente do OAuth dos restaurantes, e executar ensaio financeiro isolado com autorização específica. Conferir cobrança, webhook, vínculo do contrato e crédito na conta do proprietário; capacidade/HTTP 200/mock não substituem esse comprovante. Nenhuma cobrança real foi criada nesta revisão.

Rollback: reverter o PR; sem migração nem reescrita de dados. Não apagar filas ou pagamentos para contornar falhas.

Fontes: código da main e dos PRs, endpoints públicos, metadados Railway e PostHog consultados em 20/10; [estados de pagamento Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/response-handling/query-results?scope=prod), [assinaturas pendentes](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments), [configuração SDK PostHog](https://posthog.com/docs/libraries/js/config).
