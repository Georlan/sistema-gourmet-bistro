# Inscrição automatizada de restaurantes

## Regra comercial canônica

Plano e ciclo → dados mínimos salvos → aceite jurídico → autorização recorrente → liberação → 7 dias grátis → primeira cobrança automática → convite e primeiro acesso.

A mensalidade fixa do KÔMA segue a mesma regra em qualquer forma de pagamento disponibilizada no checkout:

- **R$ 0 de mensalidade fixa hoje**;
- o cliente apenas autoriza a recorrência antes da liberação;
- os **7 dias grátis começam na liberação do restaurante**;
- a primeira cobrança automática ocorre somente após o fim do trial;
- mensal renova mensalmente e anual renova a cada 12 meses;
- o anual conserva o desconto de 10% sobre a mensalidade fixa, mas não é cobrado antecipadamente no dia da adesão;
- não existem “dias bônus” em substituição ao trial;
- Pix avulso/QR Code antecipado não é um método válido para novas assinaturas SaaS.

Métodos recorrentes atualmente modelados no backend: `credit_card` e `pix_automatic`. Métodos futuros só podem ser publicados quando cumprirem a mesma regra de autorização recorrente + trial + cobrança posterior.

## Comportamento entregue

- Nome do restaurante, responsável, e-mail e WhatsApp são persistidos antes de pedir documento ou forma de pagamento. O SuperAdmin acompanha esses registros em **Inscrições**. Após 24 horas sem atividade registrada, a inscrição recebe indicação de possível desistência; isso não cancela contratos nem autorizações.
- A retomada usa token aleatório enviado em `X-Signup-Token`. Só o hash fica no banco e só o token fica no navegador. Dados de contato ficam criptografados. O rascunho expira em 30 dias.
- O contrato aceito é imutável e é recuperado sem novo aceite. Valores da cobrança vêm do comprovante assinado, mesmo se o catálogo mudar depois.
- **Cartão mensal/anual:** cria autorização recorrente com trial de 7 dias. Autorização não comprova pagamento; as faturas posteriores são reconciliadas separadamente.
- **Pix Automático mensal/anual:** cria uma assinatura pendente no Mercado Pago e recebe `init_point` para o cliente autorizar a recorrência no ambiente do provedor. O KÔMA só aceita a autorização como pronta depois que o provedor confirma o preapproval e o método corresponde a Pix. Nenhuma cobrança Pix avulsa é gerada pelo checkout SaaS.
- `payment_method_type=pix` é recusado para novas contratações. Registros históricos podem continuar existindo para reconciliação/migração, mas nunca liberam uma nova assinatura.
- Quando `KOMA_SAAS_MANUAL_RELEASE_REQUIRED=true`, uma autorização recorrente pronta entra em `awaiting_release`; nenhum tenant é criado antes da ação do SuperAdmin.
- Na liberação, o backend sincroniza no provedor a data da primeira cobrança com o fim do trial. Se essa sincronização falhar, o tenant não é liberado.
- Toda assinatura recém-provisionada nasce `trialing`, independentemente de cartão ou Pix Automático. Não existe caminho especial `active` para Pix anual antecipado.
- A ativação é idempotente. Repetir webhook ou retomar uma ativação interrompida não cria outro restaurante.
- Retentativas com resultado incerto procuram a autorização anterior antes de permitir nova recorrência.
- Confirmação e convite entram em fila persistente. O worker tenta e-mail/WhatsApp, conserva falhas para diagnóstico e permite reagendamento no SuperAdmin.
- No primeiro acesso, o restaurante pode importar o JSON do catálogo e revisar os dados antes da publicação nos canais existentes.

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

Cartão e Pix Automático são recorrentes e podem cancelar as cobranças futuras. Cancelamento durante o trial impede a primeira cobrança, preservando o acesso até o fim do período vigente. Cancelamento após pagamento preserva o acesso até o fim do período já contratado, sujeito às regras jurídicas aplicáveis.

## Notificações

- E-mail: `RESEND_API_KEY`, `EMAIL_FROM`.
- Aviso ao operador: `KOMA_OWNER_EMAIL` e, se usado, `KOMA_OWNER_WHATSAPP_PHONE`.
- WhatsApp: integração existente + `KOMA_WHATSAPP_AUTOMATION_ENABLED=true`.
- Worker: `ENABLE_OUTBOX_WORKER=true`.

## Homologação obrigatória antes de habilitar checkout

Executar no ambiente isolado:

1. cartão autorizado → `awaiting_release` → liberação → assinatura `trialing` → R$ 0 hoje;
2. cancelamento do cartão durante o trial → nenhuma primeira cobrança;
3. primeira fatura de cartão aprovada/recusada após o trial e replay idempotente;
4. Pix Automático → redirecionamento para `init_point` → autorização Pix confirmada → `awaiting_release` → liberação → `trialing` → R$ 0 hoje;
5. cancelar Pix Automático durante o trial;
6. confirmar que `payment_method_type=pix` é recusado e nunca provisiona tenant;
7. repetir webhooks/preapprovals e validar idempotência;
8. validar convite, primeiro acesso, e-mail e WhatsApp.

## Fora do checkout até homologação própria

NuPay, carteira Mercado Pago, débito e anual parcelado não devem ser anunciados como disponíveis enquanto não suportarem explicitamente a regra canônica: autorização recorrente, R$ 0 hoje, 7 dias grátis e cobrança automática posterior.

Importação de PDF/foto com IA continua separada deste fluxo de billing.
