# WhatsApp para o cliente — opt-in simples por pedido, sem cadastro obrigatório

## Decisão de produto

O cliente pode finalizar normalmente como visitante informando o celular com DDD.
Na revisão final aparece **uma única caixa de seleção opcional**, inicialmente
desmarcada: `Quero receber atualizações deste pedido pelo WhatsApp`.

- Sem login, e-mail, senha ou código novo de verificação.
- O clique na caixinha registra o consentimento declarado **para aquele
  pedido**, não confirmação de titularidade do telefone e não marketing.
- Cliente autenticado e visitante têm o mesmo controle; login sozinho
  nunca marca a caixa.
- Para retirada e entrega somente. Consumo no local não exibe opção.
- O chat, tracking ao vivo, Meus Pedidos, SSE e notificações atuais do
  Cardápio Online seguem inalterados mesmo sem WhatsApp.
- Não tratar número reconhecido automaticamente no checkout como login
  nem vincular pedido visitante a conta de terceiro.

## Implementação disponível, rollout desligado

- `CardapioPedidoCreate.whatsapp_status_opt_in` é `bool` estrito,
  opcional, default `false`.
- `CreateOrderCommand` carrega consentimento até a comanda;
  `Comanda.whatsapp_status_opt_in` é `NOT NULL DEFAULT FALSE`,
  criado na migration `3c6e8f21a409`.
- O Web Adapter aceita o opt-in mesmo sem `customer_token`, desde
  que tenha sido solicitado explicitamente, modalidade retirada/entrega,
  e telefone brasileiro sintaticamente válido. Não pressupõe posse.
- Em futura entrega, checar consentimento armazenado, tenant, comanda,
  telefone de contato daquela comanda e eventual conta vinculada; não
  inferir destinatário por outras comandas ou clientes.
- UI habilitada somente com build flag explícita
  `VITE_CUSTOMER_WHATSAPP_STATUS_OPT_IN_ENABLED=true`.
  **Padrão: desligado**. Não ligar em Cloudflare Pages até haver
  transporte oficial/consentido com opt-out e orçamento real homologados.
  Assim, não prometemos ao consumidor uma mensagem que ainda não enviamos.
- **Nenhum sender de WhatsApp ao cliente é criado ou ativado por este PR**;
  esse consentimento sozinho não autoriza disparos por Evolution.

## Avisos mínimos desejados

Somente eventos canônicos emitidos pelo KÔMA, nunca polling do WhatsApp:

1. Recebido, apenas quando o pedido for efetivamente liberado à operação.
2. Em caso de recusa ou cancelamento, um aviso excepcional.
3. Pronto para retirada **ou** saiu para entrega (conforme modalidade).

Nada ao passar por aceito/preparando ou finalizado. Em entrega, pronto
não é igual a saiu para entrega. A outbox deverá consultar o último
estado antes de enviar e descartar avisos obsoletos.

## Pendências obrigatórias antes de ativar

- [x] Escolha voluntária simples sem cadastro, desmarcada por padrão.
- [x] Snapshot de consentimento por pedido, com fallback seguro em false.
- [x] Contato guest preservado como guest; checagem de tenant e telefone.
- [x] UI isolada sob flag default-off; tracking/chat existentes preservados.
- [ ] Implementar descadastro/opt-out com bloqueio imediato por número
      e restaurante (inclusive bloqueio de terceiro que recebeu por engano).
- [ ] Orçamento por restaurante (meta R$ 10/mês) e limite global no número
      Business, sem confiar em variação de texto/intervalos anti-ban.
- [ ] Adaptação de envio por API oficial da Meta, templates utilitários e
      callback de entrega; não lançar envio automático ao consumidor via Baileys.
- [ ] Pipeline outbox idempotente, sem payload de telefone em claro, com
      cancelamento para eventos atrasados e testes cross-tenant.
- [ ] Testes manuais em sandbox e homologação de opt-in/opt-out antes de
      habilitar a flag de frontend ou qualquer sender em produção.

## Privacidade

O texto do checkbox informa a finalidade de atualizações deste pedido,
sem promoções e sem obrigatoriedade; o registro associa-se ao pedido e a
seu timestamp. O número digitado não é prova da titularidade, portanto a
liberação de envio deve privilegiar conteúdo mínimo, autorização revogável
e prevenção de mensagens para terceiros. Nunca registrar telefones reais,
tokens ou conteúdo integral das mensagens em outbox/logs/commits.
