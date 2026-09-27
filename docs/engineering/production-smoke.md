# Smoke não destrutivo de produção

O workflow `.github/workflows/production-smoke.yml` roda diariamente às 09:17 UTC e também pode ser iniciado manualmente em **Actions → Production smoke (non-destructive)**. Ele não é um check de merge e não inicia deploy. O frontend padrão é `https://app.komafood.com.br`; as repository variables `KOMA_PRODUCTION_FRONTEND_URL` e `KOMA_PRODUCTION_API_URL` podem substituir os padrões.

O script `scripts/production-smoke.mjs` usa somente `GET` e `OPTIONS`: verifica `/health/live`, `/health/ready`, `/api/contracts/readiness`, HTML do frontend, as três páginas públicas de contratação e o preflight CORS de `/cardapio/pedidos`. Ele exige identidade jurídica pronta e pode conferir `KOMA_EXPECTED_API_SHA` quando fornecido manualmente. Não cria contratos, pedidos, tenants ou pagamentos.

Execução local:

```bash
node scripts/production-smoke.mjs
```

Se a API ainda estiver publicando um commit anterior, não declare o deploy concluído com base apenas no resultado do smoke: confira o SHA retornado por `/api/contracts/readiness` e o deployment Railway.
