# Web Push do Cardápio KÔMA

## Objetivo

Notificar o cliente sobre eventos importantes do pedido mesmo quando a página do
Cardápio não está em primeiro plano. SSE continua sendo o canal principal com a
página aberta; Web Push é o complemento para background/aba fechada.

## Variáveis de ambiente (backend/Railway)

```text
WEB_PUSH_ENABLED=false
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=mailto:SEU_EMAIL_OPERACIONAL
WEB_PUSH_TTL_SECONDS=3600
```

`WEB_PUSH_VAPID_PRIVATE_KEY` é segredo de backend e nunca deve usar prefixo
`VITE_`, aparecer no repositório, logs ou mensagens. O frontend recebe apenas a
chave pública pelo endpoint autorizado pelo tracking token.

Habilite `WEB_PUSH_ENABLED=true` somente depois de configurar o par VAPID e
validar uma assinatura em ambiente controlado.

## Eventos enviados

- pedido confirmado/em preparo (`producao`);
- pedido pronto (`pronto`);
- saiu para entrega (`transito`);
- pedido recusado (`recusado`);
- conclusão (`finalizado`);
- nova mensagem enviada pela equipe do restaurante.

O corpo de mensagem do chat não é enviado na notificação. O push informa apenas
que existe uma nova mensagem.

## Persistência e segurança

`order_push_subscriptions` é tenant-aware e usa FORCE RLS no PostgreSQL. Endpoint,
`p256dh` e `auth` são cifrados com a camada Fernet existente. Apenas SHA-256 do
endpoint é persistido em claro para deduplicação.

A associação pública exige o tracking token criptograficamente aleatório do
pedido e possui rate limits por conversa/IP. O token nunca é salvo na assinatura
e nunca entra no payload do push.

## iOS / iPadOS

No iPhone/iPad, o cliente é orientado a adicionar o KÔMA à Tela de Início antes
de solicitar permissão de notificações. A permissão só é pedida após gesto
explícito no botão `Ativar`.

## Service Worker

`/koma-sw.js` não implementa `fetch` nem cache. Ele não interfere no contrato de
dados dinâmicos do Cardápio; trata somente `push` e `notificationclick`.
