# KÔMA Availability Worker (Cloudflare Workers Free Tier — US\$ 0/mês)

Monitor ativo de disponibilidade em edge que executa a cada 5 minutos (`*/5 * * * *`), verifica os endpoints públicos do KÔMA (`app.komafood.com.br`, `central.komafood.com.br`, `/health/live`, `/health/ready` incluindo `db_pool` e WebSocket), realiza **reteste automático de 15 s** antes de declarar `DOWN` e envia alertas com cooldown via Telegram.

O workflow `.github/workflows/external-availability-monitor.yml` permanece ativo como backup independente.

## Deploy em 2 passos (plano gratuito Cloudflare — US\$ 0)

1. Configurar os segredos no Worker (nunca commitar tokens no repositório):

```bash
cd ops/availability-worker
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

2. Publicar o Worker:

```bash
npx wrangler deploy
```

> **Persistência opcional de estado (cooldown e `RECOVERED` entre execuções frias):** caso deseje persistência garantida em KV gratuito (100 mil leituras/dia no Free tier), crie um namespace com `npx wrangler kv namespace create MONITOR_STATE`, descomente o bloco `[[kv_namespaces]]` em `wrangler.toml` com o `id` gerado e rode `npx wrangler deploy` novamente.
