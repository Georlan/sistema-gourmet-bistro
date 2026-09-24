# Inscrição automatizada de restaurantes

## Regra comercial canônica

Plano e ciclo → dados mínimos salvos → aceite jurídico → autorização recorrente → liberação → implantação essencial → início explícito pelo administrador → 7 dias grátis → primeira cobrança automática → operação normal.

A mensalidade fixa do KÔMA segue a mesma regra em qualquer forma de pagamento disponibilizada no checkout:

- **R$ 0 de mensalidade fixa hoje**;
- o cliente apenas autoriza a recorrência antes da liberação;
- a recorrência fica **pausada durante a implantação inicial**;
- cadastro, criação de senha, perfil, horários e preparação do primeiro cardápio **não consomem nenhum dia grátis**;
- os **7 dias grátis começam somente após os 4 itens essenciais**: perfil, horários, ao menos um produto ativo publicado e modalidades de operação; o administrador deve então confirmar o início;
- no início do trial, a primeira cobrança é alinhada para D+7 antes de reativar a recorrência;
- mensal renova mensalmente e anual renova a cada 12 meses;
- o anual conserva o desconto de 10% sobre a mensalidade fixa, mas não é cobrado antecipadamente no dia da adesão;
- não existem “dias bônus” em substituição ao trial;
- Pix avulso/QR Code antecipado não é um método válido para novas assinaturas SaaS.

Métodos recorrentes modelados no backend devem obedecer à mesma regra de autorização recorrente + implantação sem consumir trial + 7 dias grátis completos + cobrança posterior. A disponibilidade comercial de cada método continua controlada pelas capabilities do ambiente.

## Comportamento entregue

- Nome do restaurante, responsável, e-mail e WhatsApp são persistidos antes de pedir documento ou forma de pagamento. O SuperAdmin acompanha esses registros em **Inscrições**. Após 24 horas sem atividade registrada, a inscrição recebe indicação de possível desistência; isso não cancela contratos nem autorizações.
- A retomada usa token aleatório enviado em `X-Signup-Token`. Só o hash fica no banco e só o token fica no navegador. Dados de contato ficam criptografados. O rascunho expira em 30 dias.
- O contrato aceito é imutável e é recuperado sem novo aceite. Valores da cobrança vêm do comprovante assinado, mesmo se o catálogo mudar depois.
- **Cartão mensal/anual:** cria autorização recorrente sem cobrar a mensalidade fixa na contratação. A autorização não comprova pagamento; as faturas posteriores são reconciliadas separadamente.
- **Pix Automático mensal/anual:** quando habilitado pelo provedor, cria uma assinatura pendente no Mercado Pago e recebe `init_point` para o cliente autorizar a recorrência no ambiente do provedor. O KÔMA só aceita a autorização como pronta depois que o provedor confirma o preapproval e o método corresponde a Pix. Nenhuma cobrança Pix avulsa é gerada pelo checkout SaaS.
- `payment_method_type=pix` é recusado para novas contratações. Registros históricos podem continuar existindo para reconciliação/migração, mas nunca liberam uma nova assinatura.
- Quando `KOMA_SAAS_MANUAL_RELEASE_REQUIRED=true`, uma autorização recorrente pronta entra em `awaiting_release`; nenhum tenant é criado antes da ação do SuperAdmin.
- Assim que uma autorização recorrente fica pronta para o fluxo de onboarding, ela deve permanecer pausada até a conclusão da implantação essencial. Se a pausa não puder ser confirmada, o fluxo falha fechado em vez de arriscar cobrança antecipada.
- Na liberação, o tenant nasce com assinatura canônica em estado `onboarding`, sem `trial_started_at`, `trial_ends_at` ou período corrente. O cliente recebe o convite e pode configurar o restaurante, mas o gate de onboarding mantém Vendas/Caixa bloqueados até os 4 itens essenciais e o início explícito do trial.
- O endpoint canônico `/api/onboarding/status` calcula o progresso usando dados reais. Após os 4 itens essenciais, `POST /api/onboarding/start-trial` inicia o trial de forma idempotente: define D+7 no provedor, reativa a recorrência, grava `trial_started_at`/`trial_ends_at` e muda a assinatura para `trialing`.
- Se o alinhamento D+7 ou a reativação do provedor falhar, o backend não inicia o trial localmente e não libera uma cobrança antecipada; a configuração já salva permanece intacta para nova tentativa.
- Recarregar a implantação depois do início do trial não renova nem empurra a data final.
- Assinaturas antigas que já estavam `trialing` ou `active` não são reescritas por esta regra.
- A ativação é idempotente. Repetir webhook ou retomar uma ativação interrompida não cria outro restaurante.
- Retentativas com resultado incerto procuram a autorização anterior antes de permitir nova recorrência.
- Confirmação e convite entram em fila persistente. O worker tenta e-mail/WhatsApp, conserva falhas para diagnóstico e permite reagendamento no SuperAdmin.
- No primeiro acesso, a implantação inicial reutiliza as telas canônicas de configuração. Perfil, horários, cardápio e modalidades são a mesma fonte de verdade usada depois na operação.
- O restaurante pode enviar PDF/foto do cardápio para implantação assistida. O envio não conclui o passo: o catálogo só conta como pronto quando houver produto realmente publicado.

## Mercado Pago

Credenciais SaaS do KÔMA são separadas do recebimento dos pedidos dos restaurantes:

- `KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN`
- `KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY`
- `KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET`
- homologação usa exclusivamente as variantes `KOMA_SAAS_MERCADO_PAGO_TEST_*` já tratadas pelo config do ambiente;
- `KOMA_SAAS_CHECKOUT_ENABLED=true` somente depois da homologação do gateway.

Webhook canônico:

`/api/integrations/saas-billing/mercado-pago/webhook`

Eventos mínimos do fluxo:

- pagamentos;
- assinatura/preapproval;
- faturas autorizadas (`subscription_authorized_payment`).

Não confundir esse endpoint com o webhook de pagamentos dos restaurantes.

## Pix Automático

O fluxo implementado usa a API de Assinaturas (`/preapproval`) em estado `pending` para obter um `init_point`. O cliente é redirecionado ao checkout hospedado do Mercado Pago para escolher/concluir o meio recorrente. A autorização só vira `ready` se o preapproval retornar autorizado e o método confirmado for Pix.

Essa parte exige homologação real com credenciais TEST antes de habilitar o checkout. Se o sandbox do provedor exigir um formato diferente para Pix Automático, a integração deve ser ajustada antes de qualquer liberação; nunca substituir o fluxo por Pix avulso antecipado.

## Cancelamento

Métodos recorrentes podem cancelar as cobranças futuras. Se o cancelamento acontecer enquanto a assinatura ainda está em `onboarding`, o trial não chegou a começar e nenhum dos sete dias foi consumido. Cancelamento durante um trial já iniciado impede a primeira cobrança e preserva o acesso até o fim do período vigente. Cancelamento após pagamento preserva o acesso até o fim do período já contratado, sujeito às regras jurídicas aplicáveis.

## Notificações

- E-mail: `RESEND_API_KEY`, `EMAIL_FROM`.
- Aviso ao operador: `KOMA_OWNER_EMAIL` e, se usado, `KOMA_OWNER_WHATSAPP_PHONE`.
- WhatsApp: integração existente + `KOMA_WHATSAPP_AUTOMATION_ENABLED=true`.
- Worker: `ENABLE_OUTBOX_WORKER=true`.

As mensagens de aceite, liberação e primeiro acesso devem dizer explicitamente que os 7 dias grátis ainda não estão correndo durante a implantação.

## Homologação obrigatória antes de habilitar checkout

Executar no ambiente isolado:

1. cartão autorizado → `awaiting_release` → recorrência pausada → liberação → assinatura `onboarding` → R$ 0 hoje;
2. permanecer mais de 24 horas em implantação e confirmar que `trial_started_at` continua `NULL` e nenhum dia grátis foi consumido;
3. concluir perfil + horários + produto ativo + modalidades e confirmar início → sincronizar primeira cobrança para D+7 → reativar recorrência → assinatura `trialing` com 7 dias completos;
4. recarregar/reentrar várias vezes e confirmar idempotência: a data final do trial não se move;
5. cancelar durante `onboarding` → nenhuma primeira cobrança e nenhum dia de trial consumido;
6. cancelar durante `trialing` → nenhuma primeira cobrança após o cancelamento;
7. primeira fatura de cartão aprovada/recusada após o trial e replay idempotente;
8. quando Pix Automático estiver habilitado: autorização → pausa durante implantação → 4 itens + início explícito → D+7 → `trialing`;
9. confirmar que `payment_method_type=pix` é recusado e nunca provisiona tenant;
10. repetir webhooks/preapprovals e validar idempotência;
11. validar convite, primeiro acesso, e-mail e WhatsApp;
12. validar que o gate operacional não permite Vendas/Caixa antes dos 4 itens e do início explícito.

## Fora do checkout até homologação própria

NuPay, carteira Mercado Pago, débito e anual parcelado não devem ser anunciados como disponíveis enquanto não suportarem explicitamente a regra canônica: autorização recorrente, R$ 0 hoje, implantação sem consumir trial, 7 dias grátis completos e cobrança automática posterior.

Importação de PDF/foto com IA continua separada da cobrança, mas faz parte do passo essencial de cardápio quando resultar em produto publicado.
