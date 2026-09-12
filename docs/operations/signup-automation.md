# Inscrição automatizada de restaurantes

## Comportamento entregue

Plano e ciclo → dados mínimos salvos → contratação e pagamento → ativação → convite e primeiro acesso.

- Nome do restaurante, responsável, e-mail e WhatsApp são persistidos antes de pedir documento ou cartão. O superadmin acompanha esses registros em **Inscrições**. Após 24 horas sem atividade registrada, a inscrição recebe indicação de possível desistência; isso não cancela contratos nem pagamentos.
- A retomada usa um token aleatório de 256 bits, enviado em `X-Signup-Token`. Só o hash fica no banco e só o token fica no navegador. Dados de contato ficam criptografados. O rascunho expira em 30 dias e é removido pelo worker; evidências de contratos aceitos mantêm sua retenção independente.
- O contrato aceito é imutável e é recuperado sem novo aceite. Valores da cobrança vêm do comprovante assinado, inclusive se os preços do catálogo mudarem depois.
- Cartão mensal/anual: autorização para primeira cobrança após 7 dias, com cobrança mensal ou uma cobrança anual a cada 12 meses. Autorização do mandato não comprova pagamento; faturas são verificadas no Mercado Pago. O administrador pode cancelar a renovação no primeiro acesso ou em Conta & assinatura → documentos do contrato. Cancelar não solicita reembolso e preserva o período vigente.
- Pix anual: pagamento único, confirmação pelo provedor, 12 meses de acesso mais 7 dias de bônus. Uma cobrança pendente é reutilizada; nova chave só é gerada depois de o provedor confirmar cancelamento/rejeição da anterior.
- A ativação é automática e idempotente. Repetir um webhook ou retomar uma ativação interrompida não deve criar outro restaurante. Retentativas de cartão com resultado incerto procuram a autorização anterior antes de permitir qualquer nova assinatura.
- Confirmação e convite entram em uma fila persistente na mesma transação do contrato/provisionamento automático. O worker tenta e-mail/WhatsApp, conserva falhas para diagnóstico e permite reagendamento no superadmin. Envios têm validade de 72 horas; convites expirados devem ser renovados em Acessos. E-mail usa chave de idempotência; WhatsApp tem semântica de pelo menos uma entrega e pode repetir se houver queda após o provedor aceitar a mensagem.
- No primeiro acesso, o restaurante importa JSON no formato existente do catálogo, revisa os preços e escolhe adicionar/atualizar por ID ou substituir. Produtos ausentes só são inativados no modo substituir. Importações vazias, preços inválidos e IDs duplicados são recusados. Categorias e campos opcionais do JSON são preservados; complementos/escolhas obrigatórias exigem configuração no catálogo. O evento existente atualiza caixa, garçom e cardápio digital.

## Habilitação em produção

Aplicar as migrações Alembic antes de subir o backend. Foram adicionadas tabelas globais pré-tenant sem leitura direta pelo papel `koma_app`, com funções restritas em `koma_internal`. O smoke PostgreSQL testa o papel real.

Configurar as credenciais **SaaS do KÔMA**, separadas do recebimento dos pedidos dos restaurantes:

- `KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN`
- `KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY`
- `KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET`
- Webhook: `/api/integrations/saas-billing/mercado-pago/webhook`, incluindo eventos de pagamentos, assinaturas e faturas autorizadas (`subscription_authorized_payment`).
- `KOMA_SAAS_CHECKOUT_ENABLED=true` somente após homologação. A disponibilidade efetiva é consultada em `/api/contracts/payment-methods`; nenhuma credencial privada sai nessa resposta.
- Para entrega: `RESEND_API_KEY`, `EMAIL_FROM`; WhatsApp usa a integração já existente, `KOMA_WHATSAPP_AUTOMATION_ENABLED` e, para avisos ao operador, `KOMA_OWNER_WHATSAPP_PHONE`.
- O worker usa o ciclo de vida já existente e depende de `ENABLE_OUTBOX_WORKER=true` em produção. Sem ele, mensagens continuam persistidas, mas não são despachadas e a limpeza dos rascunhos expirados não roda.

A homologação deve exercitar cartão autorizado, primeira fatura paga/recusada, cancelamento no trial, Pix aprovado, repetição de webhook, retomada e entrega do convite. Não há homologação de transação real ou deploy em produção nesta entrega.

NuPay, Pix Automático, carteira Mercado Pago e anual parcelado não são anunciados como disponíveis. Dependem de integração/homologação e, no parcelamento, da confirmação das condições de juros e liquidação da conta. Esta entrega prioriza cartão e Pix para reduzir custo de operação. Importação de PDF/foto com IA também permanece fora desta etapa.

## Evidências locais

A regressão completa encontrou 1.207 aprovados, 7 ignorados e 15 falhas. As mesmas 15 falhas foram reproduzidas em checkout separado do commit original `f3d0ef9`, nas áreas de SmartPOS, impressão e contratos estáticos de interface. Elas não foram alteradas nesta tarefa. As suítes específicas da inscrição, pagamento, catálogo e segurança, os testes de frontend e as migrações são executados separadamente sobre a implementação final; consultar também os resultados do CI da PR.

Validação final desta entrega: 95 testes específicos de backend e smoke crítico aprovados; 25 testes de contrato/retomada repetidos após fixar a proveniência jurídica; 517 testes unitários de frontend após incorporar a main, TypeScript e build aprovados; 32 cenários de navegador em oito larguras aprovados. Migrações de ida e volta e teste de runtime PostgreSQL 17 aprovados. Esses números são evidências locais, não homologação do Mercado Pago.
