# WhatsApp de status ao cliente — contrato seguro (fase de preparação)

Esta implementação **NÃO envia notificações**. Prepara o snapshot de
consentimento de forma auditável na comanda e os predicados de segurança que
serão obrigatórios no futuro transporte.

## Entrada e armazenamento

- `CardapioPedidoCreate.whatsapp_status_opt_in` aceita booleano opcional,
  `false` por padrão; consumidores legados continuam compatíveis.
- O Web Adapter só transforma a opção em `true` se o usuário estiver
  autenticado no contexto daquele restaurante e
  `Cliente.telefone_verificado_em` estiver preenchido.
- O comando canônico propaga a permissão por pedido, apenas no canal
  `WEB_CARDAPIO`, e a grava em
  `Comanda.whatsapp_status_opt_in` com `DEFAULT FALSE NOT NULL`.
- Pedidos anteriores continuam `false`. A flag não é deduzida da
  existência de telefone, e-mail, token ou perfil do cliente.
- O telefone continua criptografado no modelo `Comanda`; a nova coluna
  não contém dados pessoais nem autorização para marketing.
- Não exibir a opção no checkout nesta fase: aceitar consentimento sem uma
  funcionalidade de envio e revogação funcionando induziria o cliente a uma
  expectativa enganosa. A interface deverá ser aberta junto do transporte.

## Invariantes do futuro sender

Mesmo diante de `whatsapp_status_opt_in = true`, um dispatcher precisa
verificar **novamente**, no momento de cada evento:

1. Comanda, evento e cliente com o MESMO `restaurante_id` e
   `Comanda.cliente_id = Cliente.id`.
2. Telefone atual do cliente verificado, correspondente ao telefone
   de entrega guardado na comanda.
3. Consentimento específico para atualização desse pedido ainda válido;
   implementar revogação persistente e opt-out/STOP antes do rollout.
4. Pedido online realmente confirmado ou liberado, sem notificar Pix pendente.
5. Evento de status canônico deduplicado:
   aceite, pronto/retirada, saída/entrega, cancelamento/recusa.
6. Respeitar os modelos **utilitários aprovados** e a janela de atendimento
   da Meta Cloud API. Um número digitado no checkout não cria a janela de
   conversação do WhatsApp.
7. Via Evolution, manter envio ao cliente **desabilitado**, independentemente
   da flag da comanda: essa não é uma autorização da plataforma Meta para
   mensagens automáticas proativas.

## Etapas ainda pendentes

- [x] Consentimento booleano por pedido, default falso.
- [x] Condição de sessão autenticada + telefone verificado no checkout.
- [x] Função pura que nega cross-tenant, mudança de telefone e revogação.
- [ ] UI transparente e opcional no checkout, com base legal e descrição clara.
- [ ] Controle de opt-out persistente.
- [ ] Outbox de status canônica, idempotente e auditável.
- [ ] Canal Meta com templates aprovados e rate limit global por remetente.
- [ ] Homologação com números de teste autorizados antes de ativar a UI.

**Não colocar números pessoais, tokens, mensagens integrais ou chaves em
commits, logs ou eventos públicos.**
