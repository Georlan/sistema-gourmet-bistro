# Smoke não destrutivo de produção

O KÔMA possui um smoke de produção em `.github/workflows/production-smoke.yml`. Ele continua disponível para disparo manual e também roda automaticamente depois que o **Koma Quality Gate** da `main` termina com sucesso.

Ele executa somente requisições sem mutação:

- `GET /health/ready` no backend;
- `GET /api/contracts/readiness`, exigindo identidade jurídica do prestador válida sem expor seus dados sensíveis;
- `GET` da aplicação web e validação de resposta HTML;
- `GET /contratar/pocket`, `/contratar/pro` e `/contratar/premium`, validando que as três entradas públicas de contratação carregam sem criar aceite;
- `OPTIONS /cardapio/pedidos` simulando o preflight real do cardápio, com `Origin`, `POST`, `Content-Type` e `X-Idempotency-Key`.

O smoke falha se o backend ou frontend não responderem com sucesso, se a identidade jurídica necessária para emitir comprovantes não estiver pronta, se alguma rota pública de contratação deixar de carregar, ou se o CORS deixar de autorizar a origem do frontend, o método `POST` ou os headers necessários ao checkout.

## Readiness contratual e identidade do deploy

`GET /api/contracts/readiness` é deliberadamente não sensível. A resposta informa apenas:

- se a identidade jurídica está configurada e válida;
- versão jurídica vigente;
- commit e blob SHA que ancoram o pacote Legal;
- SHA Git do deploy atual quando o runtime é originado pelo GitHub/Railway.

O endpoint não retorna nome, CPF, endereço ou localidade do prestador. O SHA do deploy é uma identidade pública do código e permite provar que o smoke testou a revisão recém-publicada, em vez da versão anterior ainda ativa durante a troca.

## Execução automática após a `main`

O workflow escuta a conclusão do **Koma Quality Gate** na `main`. Se o gate estiver verde, ele recebe o `head_sha` da execução e define esse valor como `KOMA_EXPECTED_API_SHA`.

Como o Railway também recebe `RAILWAY_GIT_COMMIT_SHA` em deploys originados do GitHub, o smoke compara os dois valores. Enquanto a API ainda estiver servindo a revisão anterior, o teste falha naquela tentativa e repete a leitura. A janela atual é de até 24 tentativas com intervalo de 10 segundos.

Isso evita dois problemas:

1. não cria dependência circular com o **Wait for CI** do Railway, porque o smoke só inicia depois que o quality gate termina;
2. não produz falso verde contra o deploy anterior, porque exige o SHA exato do backend antes de validar contrato, frontend e CORS.

O smoke automático não é usado como justificativa para contornar o quality gate e não força deploy/redeploy. Se o Railway não publicar a revisão esperada dentro da janela, o smoke fica vermelho para investigação.

## Execução manual

No GitHub, abra **Actions → Production smoke (non-destructive) → Run workflow**. Os campos de frontend e API já usam as URLs públicas atuais como padrão. No disparo manual não existe SHA esperado obrigatório, então o workflow valida o estado que estiver publicado naquele momento.

Para trocar as URLs sem editar o workflow, configure as repository variables `KOMA_PRODUCTION_FRONTEND_URL` e `KOMA_PRODUCTION_API_URL`, ou informe URLs diferentes no disparo manual.

Também é possível executar localmente:

```bash
KOMA_FRONTEND_URL=https://sistema-gourmet-bistro.pages.dev \
KOMA_API_URL=https://sistema-gourmet-bistro-production.up.railway.app \
node scripts/production-smoke.mjs
```

Para exigir uma revisão específica do backend em uma execução local ou de CI:

```bash
KOMA_EXPECTED_API_SHA=<sha-completo> \
KOMA_FRONTEND_URL=https://sistema-gourmet-bistro.pages.dev \
KOMA_API_URL=https://sistema-gourmet-bistro-production.up.railway.app \
node scripts/production-smoke.mjs
```

O script não cria contratos, pedidos ou tenants, não autentica, não movimenta estoque e não toca em pagamentos. Ele usa apenas `GET` e `OPTIONS`.
