# Smoke não destrutivo de produção

O KÔMA possui um smoke manual de produção em `.github/workflows/production-smoke.yml`.

Ele executa somente requisições sem mutação:

- `GET /health/ready` no backend;
- `GET /api/contracts/readiness`, exigindo identidade jurídica do prestador válida sem expor seus dados sensíveis;
- `GET` da aplicação web e validação de resposta HTML;
- `GET /contratar/pocket`, `/contratar/pro` e `/contratar/premium`, validando que as três entradas públicas de contratação carregam sem criar aceite;
- `OPTIONS /cardapio/pedidos` simulando o preflight real do cardápio, com `Origin`, `POST`, `Content-Type` e `X-Idempotency-Key`.

O smoke falha se o backend ou frontend não responderem com sucesso, se a identidade jurídica necessária para emitir comprovantes não estiver pronta, se alguma rota pública de contratação deixar de carregar, ou se o CORS deixar de autorizar a origem do frontend, o método `POST` ou os headers necessários ao checkout.

## Readiness contratual

`GET /api/contracts/readiness` é deliberadamente não sensível. A resposta informa apenas:

- se a identidade jurídica está configurada e válida;
- versão jurídica vigente;
- commit e blob SHA que ancoram o pacote Legal.

O endpoint não retorna nome, CPF, endereço ou localidade do prestador. Ele existe para permitir homologação de produção sem criar um aceite fictício juridicamente vinculante.

## Execução

No GitHub, abra **Actions → Production smoke (non-destructive) → Run workflow**. Os campos de frontend e API já usam as URLs públicas atuais como padrão.

Para trocar as URLs sem editar o workflow, configure as repository variables `KOMA_PRODUCTION_FRONTEND_URL` e `KOMA_PRODUCTION_API_URL`, ou informe URLs diferentes no disparo manual.

Também é possível executar localmente:

```bash
KOMA_FRONTEND_URL=https://sistema-gourmet-bistro.pages.dev \
KOMA_API_URL=https://sistema-gourmet-bistro-production.up.railway.app \
node scripts/production-smoke.mjs
```

O script não cria contratos, pedidos ou tenants, não autentica, não movimenta estoque e não toca em pagamentos. Ele usa apenas `GET` e `OPTIONS`.
