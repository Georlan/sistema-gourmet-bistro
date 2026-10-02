# KÔMA — pacote pré-primeiro-cliente

Base auditada em 02/10/2026: `7b4b183c2f4bd8ce4eed0052959a032c94caa315`.
Este documento distingue código, runtime e validação; não declara prontidão por
presença de código. Política operacional: `production-release-policy.md`.

## Evidências iniciais

- CONFIRMADO NO RUNTIME: projetos Railway `passionate-truth` e `Koma Homologacao`;
  produção Kôma em `main`, `/backend/**`, uma réplica sfo, health `/health/ready`.
- CONFIRMADO NO RUNTIME: havia reset explícito do tenant 6 no pre-deploy. Removido
  pela API de configuração e relido: agora apenas `alembic upgrade head`. Não foi
  disparado redeploy/reset por essa contenção. Execução histórica: NÃO VERIFICADO.
- CONFIRMADO NO CÓDIGO: PR #889 isola sessão por aba/portal, #923 trata chunks
  ausentes e #936 separa sessão rejeitada de indisponibilidade no onboarding.
- CONFIRMADO NO RUNTIME: smoke inicial GET/OPTIONS passou health, readiness,
  contratos, CORS, assets JS/CSS e 404/no-store de asset inexistente.
- CONFIRMADO NO CÓDIGO: 17 workflows targeted, filtros de paths próprios;
  `Main Push Safety Gate` é pós-merge. CONFIRMADO NO RUNTIME: ruleset 23316793
  exige somente `Merge verdict`, base atualizada e resolução das threads.
- CONFIRMADO NO CÓDIGO: ORM tenant-scoped, RLS por transação, idempotência de
  pedidos, locks/timeouts de migrations e logs de duração HTTP.
- CONFIRMADO NO CÓDIGO: defaults pool 5 + 5 / timeout 15; WebSocket revalida a
  sessão a cada 30s; fallback operacional 8s e Caixa 12s; SW sem fetch/cache.
- NÃO VERIFICADO: valores efetivos de DB_POOL_* e destino do banco. OAuth Railway
  expõe nomes, não valores. A presença de Postgres no projeto não prova que seja
  o banco core. Separação dos projetos não prova separação dos DATABASE_URLs.
- HIPÓTESE FORTE: pressão no pool pode explicar lentidão; a coincidência de 15s
  não demonstra causalidade. Amostra inicial de 501 logs deploy e 501 HTTP não
  mostrou QueuePool TimeoutError/5xx; não representa todo o histórico.
- RISCO ARQUITETURAL: timers fixos podem sincronizar após queda de realtime.
- REFUTADO: seria necessário criar observabilidade e capacidades do zero.
  Já existem latência por request e RestauranteCapability com override/auditoria.

## Pacote essencial

1. Desativar reset legado; proteger regressões auth/session/order antes de merge;
   linter AST de migrations novas e instrumentação do pool, sem tuning.
2. Reusar capacidades para release por tenant, resolver no backend durante a
   sessão, formalizar QA e validar sua operação pelo Super Admin oficial.
3. Validar separadamente deploy backend/frontend e reportar qualquer falta de
   evidência. O tenant 6 continua recebendo atualizações normais, nunca QA.

## Limites e adiamentos

Recuperação de chunk pode recarregar a tela; não garante preservação de rascunho
não enviado nem retenção eterna de assets. Não alterar requests/DTOs/eventos
incompatíveis durante este pacote. Clientes anteriores à sessão por aba exigem
novo login seguro; não migrar identidade compartilhada sem prova de origem.

Adiados: tuning do pool, plataforma de experimentos, canary percentual, reset
QA automático, refactor amplo e retenção complexa de assets. Sem prova de banco
isolado e tenant QA não há autorização técnica para smoke destrutivo.
