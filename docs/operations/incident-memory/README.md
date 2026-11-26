# Memória Versionada de Incidentes (`incident-memory`)

Este diretório armazena padrões recorrentes de incidentes do KÔMA em formato estruturado (`index.json`) para consumo direto pelo CLI de triagem somente leitura (`npm run ops:triage`) e por agentes de suporte.

## Regras obrigatórias de governança

1. **Zero PII ou credenciais:** nunca registrar telefones, e-mails, CPFs/CNPJs, nomes de clientes reais, tokens, chaves de API, secrets ou IDs de tenants privados.
2. **Schema explícito (`schema_version: "1.0"`):** cada entrada em `index.json` deve possuir os 10 campos validados automaticamente em `tests/incidentMemorySchema.test.ts`:
   - `id`, `title`, `category`
   - `symptom_signatures`, `log_patterns`, `likely_causes`
   - `verification_steps`, `safe_remediation`
   - `customer_guidance_go_id` (DEVE ser `null` ou um ID canônico não-mutante de `CASHIER_SIDEBAR_GROUPS` em `src/components/caixa/navigation/cashierNavigation.ts`)
   - `prevention_refs`
3. **Somente causa-raiz verificada:** novos padrões entram por PR pequeno após diagnóstico comprovado em produção/testes; nunca adicionar suposições não verificadas.
4. **Orientação acionável via deep link:** incidentes resolvidos por configuração do próprio estabelecimento devem apontar o `customer_guidance_go_id` exato para envio seguro em `https://app.komafood.com.br/?go=<id>`.

## Promoção de incidentes resolvidos

Após confirmar causa-raiz, PR/commit de correção e teste de regressão, adicione um padrão reutilizável usando:

```bash
npm run ops:memory:promote -- --from-json caminho/entrada-resolvida.json --dry-run
npm run ops:memory:promote -- --from-json caminho/entrada-resolvida.json
```

O utilitário bloqueia automaticamente qualquer tentativa de gravar e-mail, CPF/CNPJ, token ou segredo em `index.json`.
