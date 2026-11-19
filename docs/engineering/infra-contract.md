# Contrato de infraestrutura KÔMA · 2026-09-27

## Produção

- Frontend canônico: Cloudflare Pages `sistema-gourmet-bistro`, branch `main`, domínio customizado `app.komafood.com.br` com CNAME exato para `sistema-gourmet-bistro.pages.dev` e SSL ativo. O Worker `koma-edge-router` não intercepta `app`; resta apenas a rota `www.komafood.com.br/*` para redirecionamento. Build `npm run build`, saída `dist`, root do repositório; `VITE_API_URL` e `VITE_WS_URL` apontam para a API Railway de produção.
- API: Railway projeto `passionate-truth`, serviço `Kôma`, branch `main`, root `/backend`, região `sfo`, **1 réplica**. Build Railpack; start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; pre-deploy `alembic upgrade head`; watch `backend/**`; healthcheck `/health/ready`; `/health/live` público. Volume `/app/data` preservado.
- Banco autoritativo do KÔMA: PostgreSQL no Supabase. `DATABASE_URL`, `RUNTIME_DATABASE_URL` e `MIGRATION_DATABASE_URL` da API apontam para o mesmo destino; o serviço Railway `Postgres` é usado pela Evolution API, não pela API KÔMA. Redis Railway atende ao cache da Evolution API. Não mover bancos nem aumentar réplicas nesta missão.
- Backup do banco KÔMA: Railway `Postgres S3 Backup` (`ItsNoxius/railway-postgres-s3-backups@main`, cron `0 3 * * *` UTC, `MAX_BACKUPS=10`) faz `pg_dump` do PostgreSQL principal (Supabase) e grava arquivos `.tar.gz` no bucket Railway `pre-purge-backup-20260916` (`sjc` via `t3.storageapi.dev`). Verificação local: `node scripts/check-backup-freshness.mjs`; monitoramento automático diário (`05:00 UTC` + `workflow_dispatch`): `.github/workflows/backup-freshness-monitor.yml` (requer secret `RAILWAY_TOKEN` no GitHub Actions e abre/fecha issue única em falha). Nenhum segredo é registrado.
- Cobertura separada: o backup S3 acima protege o **PostgreSQL principal do KÔMA (Supabase)**, cujo plano Free não possui backups agendados nem PITR nativos. Ele **não** cobre o Postgres Railway da Evolution API, o Redis da Evolution nem os buckets do Supabase Storage (`cardapio-assets`, `koma-legacy-archives`). Não fazer upgrade, reiniciar bancos ou remover volumes para resolver esse limite. Registrar cópia independente e ensaio do banco Evolution antes de considerá-lo protegido.
- Recuperação: ver o escopo e as limitações do ensaio pós-STS em `post-sts-reliability-tracker.md`. Arquivo válido e upload recente não equivalem a recuperação integral de banco, mídias, configuração e agentes.
- Smoke público: `.github/workflows/production-smoke.yml`, diário e manual, somente GET/OPTIONS.

### Orçamento de conexões verificado em 2026-10-03 (atualizado B2 em 2026-11-16)

O runtime usa o pool de sessão Supabase (porta 5432), com QueuePool de quatro
conexões e overflow zero. Além desse pool, os três canais LISTEN
(`koma_operational_realtime`, `koma_order_chat` e `koma_print_jobs`) agora
compartilham **1 única conexão dedicada por processo** via
`PostgresListenMultiplexer` (`application_name=koma-listen-multiplexer`). O teto
teórico cai de **7 para 5 conexões por processo**; duas versões em rolling
deploy passam de **14 para 10 sessões** (folga de 5 no limite `pool_size=15` do
Supavisor Session Mode). Migrações usam porta 6543. Homologação tem banco distinto.

Os logs Supavisor de 2026-10-01 06:28:35 UTC registraram limite de sessão
`pool_size=15`, junto ao 500 de categorias do tenant 6. Esse limite é distinto
do `max_connections=60` do PostgreSQL e do timeout do QueuePool. A margem de
um cliente durante overlap não comporta ferramentas adicionais sem orçamento.
Não ampliar pool, overflow, processos ou réplicas sem recalcular listeners,
overlap e demais clientes. Evitar consultas diagnósticas pelo pool de sessão
durante a troca de versões. Não migrar LISTEN para transaction pooling: o
listener requer afinidade de sessão. Qualquer separação futura dos pools deve
preservar a identidade/RLS do runtime e validar reconexão e polling fallback.

## Homologação

- Railway projeto `Koma Homologacao`, serviço `Koma`, root `/backend`, `sfo`, **2 réplicas**, healthcheck `/health/ready`.
- `DATABASE_URL` e `MIGRATION_DATABASE_URL` apontam para um Postgres Railway privado, distinto do Supabase de produção. O serviço `purge-validator` fica sem source GitHub/auto-deploy para não atualizar usuário QA a cada push da `main`.
- Ambiente isolado para `capacity:five-tenants`; não enviar email/WhatsApp real nem cobrar pagamentos reais.

## Alterações controladas

O frontend Railway `Frontend` e os jobs `purge-runner`, `pre-purge-copy-runner` e `pre-purge-copy-job` foram excluídos após confirmação específica. O **bucket** `pre-purge-backup-20260916` (`sjc`) é o **destino ativo** dos backups diários do `Postgres S3 Backup` (10 cópias recentes de `2026-11-06` a `2026-11-15` verificadas em `15/11/2026`) e **nunca deve ser excluído**. O serviço `pre-purge-backup-20260916` (`postgres-ssl:18`, sem consumo ativo no ciclo atual) também permanece preservado até validação explícita. Nunca aplicar patches Railway antigos em bloco; conferir diff, zerar mudanças obsoletas e confirmar `stagedChanges=null` antes de novos deploys.

## FinOps, rede interna e monitoramento (B0 — atualizado 2026-11-19)

- **Linha de base Railway (`Nov 10 – Dec 10`, leitura `19/11/2026`):** Hobby Plan (`$5.00` incluído), fatura `2026-11-10` de `$5.92` **confirmada paga** (sem aviso `past due`), consumo acumulado `$1.82`, projeção `Estimated Bill: $3.97`. Uso por projeto: `passionate-truth` `$1.77` e `radiant-encouragement` `$0.0494`.
- **Volume `sistema-gourmet-bistro-volume` (`500 MB`, `sfo`, `unattached`):** `0 B` usados, sem backups e custo residual mínimo (~`$0.0008`/5 dias). Preservado sem exclusão até decisão explícita de descarte.
- **Comunicação `Kôma ↔ evolution-api` (B0-10 — ATIVADA EM PRODUÇÃO em `19/11/2026`):** `EVOLUTION_API_URL` do serviço `Kôma` (`production`) foi migrada para `http://evolution-api.railway.internal:8080` (deployment `3cc740f3-9ea7-456f-8998-aefbca38fc21` `[SUCCESS]`, `/health/ready` 200 e `production-smoke.mjs` 12/12 sem falhas). Clientes Python cobertos por `backend/tests/test_evolution_internal_url.py`. **Rollback imediato:** restaurar `https://evolution-api-production-c32b.up.railway.app`.
- **Monitoramento automático de backup (B0-12/B0-13 — ATIVO em `19/11/2026`):** Project Token `github-backup-freshness-monitor` (escopado a `passionate-truth` / `production`) cadastrado como secret `RAILWAY_TOKEN` no GitHub Actions. Primeira execução verde confirmada (`backup-freshness-monitor.yml`, run `44543356742`): `Backup do banco KÔMA (Supabase) válido e enviado ao S3 em 2026-11-19T03:05:09.143Z; Backup filesize: 2.48 MB`. Alertas nativos Railway permanecem ativos (`Deployment Failed / Crashed / OOM Killed`, `Compute Email Alert` em `$5`, `Agent Hard limit: $0`, `Compute Hard limit` vazio).
- **Supabase Free (B0-08):** carência encerrada em `02/11/2026` (risco de HTTP `402` ao exceder cotas). Última leitura documentada (`15/11/2026`): DB `0.058/0.5 GB` (`12%`), Storage `0.122/1 GB` (`12%`), Egress `0.597/5 GB` (`12%`). *Spend cap* ativo; orçamento de conexões/LISTEN concluído no **B2**.
- **Ressalvas residuais de B0 (não impeditivas para operação atual):** Postgres auxiliar da Evolution API (`94ce5ad2`), Redis (`966c7b86`) e Supabase Storage (`cardapio-assets`, `koma-legacy-archives`) seguem fora da rotina S3 do Postgres principal; serviço ocioso `pre-purge-backup-20260916` (`postgres-ssl:18`, `$0.0000`) e volume unattached permanecem preservados até descarte explícito.
