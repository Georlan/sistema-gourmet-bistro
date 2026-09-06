# Smoke não destrutivo de produção

O KÔMA possui um smoke manual de produção em `.github/workflows/production-smoke.yml`.

Ele executa somente requisições sem mutação:

- `GET /health/ready` no backend;
- `GET` da aplicação web e validação de resposta HTML;
- `OPTIONS /cardapio/pedidos` simulando o preflight real do cardápio, com `Origin`, `POST`, `Content-Type` e `X-Idempotency-Key`.

O smoke falha se o backend ou frontend não responderem com sucesso, ou se o CORS deixar de autorizar a origem do frontend, o método `POST` ou os headers necessários ao checkout.

## Execução

No GitHub, abra **Actions → Production smoke (non-destructive) → Run workflow**. Os campos de frontend e API já usam as URLs públicas atuais como padrão.

Para trocar as URLs sem editar o workflow, configure as repository variables `KOMA_PRODUCTION_FRONTEND_URL` e `KOMA_PRODUCTION_API_URL`, ou informe URLs diferentes no disparo manual.

Também é possível executar localmente:

```bash
KOMA_FRONTEND_URL=https://sistema-gourmet-bistro.pages.dev \
KOMA_API_URL=https://sistema-gourmet-bistro-production.up.railway.app \
node scripts/production-smoke.mjs
```

O script não cria pedidos, não autentica, não altera tenant, não movimenta estoque e não toca em pagamentos.
