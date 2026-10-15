# Inscrição automatizada de restaurantes

## Regra comercial canônica

Plano e ciclo → dados mínimos salvos → aceite jurídico → **cartão autorizado ou Pix selecionado** → alerta único ao proprietário (e-mail + Telegram) → liberação de acesso pelo SuperAdmin → convite para criar senha → implantação essencial → liberação operacional pelo SuperAdmin → 7 dias grátis → **cobrança automática no cartão ou QR Pix a pagar** → operação normal.

A mensalidade fixa do KÔMA segue a mesma regra em qualquer forma de pagamento disponibilizada no checkout:

- **R$ 0 de mensalidade fixa hoje**;
- no cartão, o cliente autoriza a recorrência antes da liberação e ela fica **pausada durante a implantação inicial**;
- no Pix, o cliente apenas seleciona a modalidade; **nenhum QR é gerado nem pago na adesão**;
- cadastro, criação de senha, perfil, horários e preparação do primeiro cardápio **não consomem nenhum dia grátis**;
- os **7 dias grátis começam somente após os 4 itens essenciais**: perfil, horários, ao menos um produto ativo publicado e modalidades de operação; o SuperAdmin deve então conferir a implantação e liberar a operação;
- no cartão, ao iniciar o trial o backend sincroniza a primeira cobrança com D+7 e só então reativa a recorrência;
- no Pix, após o vencimento D+7 o KÔMA disponibiliza QR Code/Copia e Cola para pagamento explícito do cliente; **não existe débito Pix automático**;
- mensal renova mensalmente e anual renova a cada 12 meses;
- o anual conserva o desconto de 10% sobre a mensalidade fixa, mas não é cobrado antecipadamente no dia da adesão;
- não existem “dias bônus” em substituição ao trial;
- Pix antecipado antes dos sete dias é proibido; o QR da mensalidade só aparece quando houver valor vencido após o trial.

Cartão e Pix são as únicas modalidades públicas para novas assinaturas. Saldo Mercado Pago continua no código somente para retomada/reconciliação histórica; está oculto no checkout e rejeitado em novas tentativas. O ambiente expõe as capabilities efetivas e o checkout falha fechado quando indisponível.

## Comportamento entregue

- Nome do restaurante, responsável, e-mail e WhatsApp são persistidos antes de pedir documento ou forma de pagamento. O SuperAdmin acompanha esses registros em **Inscrições**. Após 24 horas sem atividade registrada, a inscrição recebe indicação de possível desistência; isso não cancela contratos nem autorizações.
- A retomada usa token aleatório enviado em `X-Signup-Token`. Só o hash fica no banco e só o token fica no navegador. Dados de contato ficam criptografados. O rascunho expira em 30 dias.
- O contrato aceito é imutável e é recuperado sem novo aceite. Valores da cobrança vêm do comprovante assinado, mesmo se o catálogo mudar depois.
- **Cartão mensal/anual:** cria autorização recorrente sem cobrar a mensalidade fixa na contratação. A autorização não comprova pagamento; as faturas posteriores são reconciliadas separadamente.
- **Pix mensal/anual:** a seleção `POST /api/contracts/{protocol}/billing/pix/select` registra um método sem cobrança inicial. Depois do trial, `POST /api/subscription/pix` gera QR Code/Copia e Cola na conta SaaS KÔMA do Mercado Pago somente quando existir valor devido. O cliente paga manualmente no banco, e o KÔMA confirma por webhook.
- `payment_method_type=pix` continua rejeitado no endpoint **recorrente** `/billing/setup`; o Pix universal usa exclusivamente a rota dedicada, sem mandato `/preapproval`.
- Quando `KOMA_SAAS_MANUAL_RELEASE_REQUIRED=true`, cartão autorizado ou Pix selecionado entra em `awaiting_release`; nenhum tenant é criado antes da ação do SuperAdmin.
- Autorizações de cartão devem permanecer pausadas durante a implantação; se a pausa não for confirmada, o fluxo falha fechado. Pix não possui autorização recorrente nem tentativa antecipada.
- Na liberação, o tenant nasce com assinatura canônica em estado `onboarding`, sem `trial_started_at`, `trial_ends_at` ou período corrente. O cliente recebe o convite e pode configurar o restaurante, mas o gate de onboarding mantém Vendas/Caixa bloqueados até os 4 itens essenciais e o início explícito do trial.
- O endpoint canônico `/api/onboarding/status` calcula o progresso usando dados reais. Após os 4 itens essenciais, **Super Admin → Períodos grátis → Ver implantação e liberar** usa `POST /api/super-admin/onboarding/restaurantes/{tenant_id}/release` para iniciar o trial idempotente: cartão alinha D+7 e reativa recorrência, Pix apenas define vencimento após D+7; ambos registram `trial_started_at`/`trial_ends_at` e mudam para `trialing`.
- A rota antiga `POST /api/onboarding/start-trial` recusa liberação pelo administrador do restaurante; o início comercial pertence ao SuperAdmin.
- Se o alinhamento D+7 ou a reativação do cartão falhar, o backend não inicia o trial localmente nem libera cobrança antecipada; a configuração salva permanece para nova tentativa.
- Recarregar a implantação depois do início do trial não renova nem empurra a data final.
- Assinaturas antigas que já estavam `trialing` ou `active` não são reescritas por esta regra.
- A ativação é idempotente. Repetir webhook ou retomar uma ativação interrompida não cria outro restaurante.
- Retentativas com resultado incerto procuram a autorização anterior antes de permitir nova recorrência.
- Confirmação e convite do **cliente** entram na fila de e-mail Resend, com retentativa. O convite de senha só é criado **após a liberação do acesso** pelo SuperAdmin (72h). O navegador informa que ele será enviado após essa etapa.
- Para o **proprietário KÔMA**, um único aviso por e-mail e Telegram no checkout pronto para liberação, e outro após os quatro itens essenciais aguardando sua ação. Rascunho de cadastro, aceite isolado e início do trial não geram novos avisos administrativos redundantes. A outbox é idempotente por protocolo/evento/canal.
- No primeiro acesso, a implantação inicial reutiliza as telas canônicas de configuração. Perfil, horários, cardápio e modalidades são a mesma fonte de verdade usada depois na operação.
- O restaurante pode enviar PDF/foto do cardápio para implantação assistida. O envio não conclui o passo: o catálogo só conta como pronto quando houver produto realmente publicado.

## Mercado Pago

**Duas operações, sem split de faturamento:** mensalidades do KÔMA no cartão e Pix usam o gateway SaaS da plataforma e são destinadas à conta Mercado Pago da plataforma. O Pix SaaS é gerado por `/v1/payments` sem `application_fee` ou divisão. Já o Pix de pedidos usa o token OAuth da conta escolhida pelo restaurante, pertence ao restaurante e tem taxa de plataforma zero nas novas cobranças. Não use a conta proprietária KÔMA como conta de pagamento OAuth de um restaurante.

Se KomaBilling (Assinaturas) e KomaADMIN (Checkout Transparente) forem aplicações diferentes da mesma conta recebedora:
- `MERCADO_PAGO_CLIENT_ID` / `MERCADO_PAGO_CLIENT_SECRET` pertencem à aplicação OAuth dos restaurantes;
- `KOMA_SAAS_MERCADO_PAGO_CLIENT_ID` / `KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET` permitem usar a aplicação SaaS para renovar o token de assinaturas, quando runtime OAuth está ativo;
- `KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID` identifica a aplicação de faturamento; `KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID` identifica a conta beneficiária;
- `MERCADO_PAGO_MARKETPLACE_USER_ID` identifica a conta proprietária e impede sua conexão como um restaurante comum.

Os valores privados devem ser configurados diretamente no gerenciador seguro do Railway, nunca em tickets, chat ou commits. Confirme os IDs não secretos e teste cartão/Pix em ambiente isolado antes de habilitar cobrança comercial.

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

## Pix universal

O checkout **não cobra Pix no cadastro**: apenas persiste a escolha. O Pix é gerado via API de pagamentos Mercado Pago (valor congelado no aceite comercial) quando terminar a implantação, iniciarem e terminarem os sete dias grátis e houver vencimento devido. No mensal, um novo QR por vencimento; no anual, um QR do total anual quitando doze meses. `/api/integrations/saas-pix/mercado-pago/webhook` reconcilia a confirmação. A geração só é considerada pronta após teste isolado de idempotência, vencimento, expiração, reemissão e conta recebedora.

Esse método **não tem débito automático**, mesmo quando o contratante informa CPF. Não prometer pagamento automático Pix após o trial. Não confundir a conta recebedora SaaS da plataforma com as contas OAuth Mercado Pago dos restaurantes.

## Cancelamento

Métodos recorrentes podem cancelar as cobranças futuras. Se o cancelamento acontecer enquanto a assinatura ainda está em `onboarding`, o trial não chegou a começar e nenhum dos sete dias foi consumido. Cancelamento durante um trial já iniciado impede a primeira cobrança e preserva o acesso até o fim do período vigente. Cancelamento após pagamento preserva o acesso até o fim do período já contratado, sujeito às regras jurídicas aplicáveis.

## Notificações

- E-mail: `RESEND_API_KEY`, `EMAIL_FROM`.
- Aviso ao proprietário: `KOMA_OWNER_EMAIL` e/ou `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. Enviar somente quando há **contratação pronta para liberação** e depois quando os **4 essenciais** estão concluídos; não avisar a cada passo nem ao iniciar trial. Cada evento/canal é idempotente. Sem WhatsApp para o operador.
- WhatsApp para clientes: integração existente + `KOMA_WHATSAPP_AUTOMATION_ENABLED=true`; manter desligada até homologar esse fluxo separadamente.
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
8. Pix: selecionar método sem QR no cadastro → liberação e implantação → D+7 → gerar QR só com vencimento devido → pagar em ambiente isolado → confirmar webhook e acesso;
9. confirmar que `payment_method_type=pix` é recusado no **setup recorrente**, mas Pix funciona pela rota de seleção dedicada;
10. repetir webhooks/preapprovals e validar idempotência;
11. validar e-mail de confirmação do cliente após aceite, convite após liberação do SuperAdmin, link 72h, login e onboarding; confirmar um alerta por canal no checkout e um após 4/4, sem duplicações;
12. validar que o gate operacional não permite Vendas/Caixa antes dos 4 itens e do início explícito.

## Fora do checkout até homologação própria

NuPay, Saldo Mercado Pago, débito, Pix Automático e anual parcelado não são opções de novas contratações. Histórico do saldo MP continua reconciliável; qualquer retorno comercial exige homologação própria.

Importação de PDF/foto com IA continua separada da cobrança, mas faz parte do passo essencial de cardápio quando resultar em produto publicado.

## Convites de equipe por e-mail

A criação na tela Equipe exige e-mail e mantém o telefone como contato. Convites antigos sem e-mail podem receber o endereço no próprio card antes do reenvio. O backend preserva compatibilidade com cadastros legados sem e-mail, retornando `convite_agendado=false` nesses casos.

Os convites usam Resend pela fila persistente existente (`signup_notifications`), com payload criptografado, chave idempotente por geração do convite, validade de 24 horas e retentativas limitadas. Cadastro/renovação e enfileiramento são confirmados na mesma transação. Reenviar renova o link e invalida o anterior.

A equipe mostra “na fila”, “enviado ao Resend” ou “falha”; envio aceito pelo provedor não comprova entrega na caixa de entrada. A consulta de metadados no PostgreSQL é restrita ao tenant da transação e não expõe destinatário, conteúdo ou token. Não depende da automação de WhatsApp.

## Checklist de identidade do faturamento SaaS (sem revelar credenciais)

A conta recebedora exibida nas duas aplicações Mercado Pago do proprietário é a mesma, mas a **aplicação** não é: nas capturas, KomaBilling (Assinaturas) = `815955951076095` e KomaADMIN (Checkout Transparente) = `2722128383126106`, ambas com User ID `2155440812`. São IDs públicos de identificação, **não tokens**.

A implantação do checkout de assinaturas é considerada **pronta para teste**, não homologada, apenas quando:

1. Railway, serviço backend de produção: `KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID` identifica a KomaBilling; `KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID` identifica o User ID recebedor; `KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY` e `KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN` são da mesma aplicação; `KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET` é o segredo do webhook de faturamento SaaS.
2. A conta do marketplace (`MERCADO_PAGO_MARKETPLACE_USER_ID`) aponta para esse mesmo User ID. O OAuth dos **restaurantes** (`MERCADO_PAGO_CLIENT_ID` e `MERCADO_PAGO_CLIENT_SECRET`) não pode ser automaticamente tratado como OAuth de faturamento SaaS.
3. Quando `KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED=true`: configure **ambos** `KOMA_SAAS_MERCADO_PAGO_CLIENT_ID` e `KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET` da KomaBilling se o OAuth dos restaurantes for outra aplicação. O backend agora falha fechado se a aplicação efetiva divergir da aplicação SaaS esperada, inclusive no fallback legado.
4. Quando `KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED=false`: o access token estático configurado precisa ser da KomaBilling. Tokens estáticos identificáveis pela aplicação também são verificados antes de tentar cobrar; tokens sem identificação legível ainda precisam ser validados por teste isolado.
5. A rota pública `GET /api/contracts/payment-methods-v2` deve anunciar `credit_card=true`, `pix=true` e `providerAuthReady` sem erro. Esse sinal confirma apenas pré-validações de configuração, **não pagamento aprovado**.
6. Teste isolado com credenciais TEST: autorização de cartão tokenizado, assinatura pausada durante implantação, quatro itens essenciais, liberação supervisionada, sete dias completos, cobrança no vencimento, Pix QR gerado após vencimento, expiração/reemissão, assinatura de webhook, deduplicação e confirmação do destinatário do pagamento. Nunca efetuar transações reais sem aprovação explícita.

Não copiar Client Secret, Access Token, chave de webhook, cartão ou CPF para o GitHub ou chat. Se as variáveis anteriores já estiverem corretas, não sobrescrevê-las por precaução; faça apenas as correções comprovadamente necessárias no Railway.
