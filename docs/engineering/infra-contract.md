# Contrato de infraestrutura KÔMA · 2026-09-27

## Produção

- Frontend canônico: Cloudflare Pages `sistema-gourmet-bistro`, branch `main`, domínio customizado `app.komafood.com.br` com CNAME exato para `sistema-gourmet-bistro.pages.dev` e SSL ativo. O Worker `koma-edge-router` não intercepta `app`; resta apenas a rota `www.komafood.com.br/*` para redirecionamento. Build `npm run build`, saída `dist`, root do repositório; `VITE_API_URL` e `VITE_WS_URL` apontam para a API Railway de produção.
- API: Railway projeto `passionate-truth`, serviço `Kôma`, branch `main`, root `/backend`, região `sfo`, **1 réplica**. Build Railpack; start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; pre-deploy `alembic upgrade head`; watch `backend/**`; healthcheck `/health/ready`; `/health/live` público. Volume `/app/data` preservado.
- Banco autoritativo do KÔMA: PostgreSQL no Supabase. `DATABASE_URL`, `RUNTIME_DATABASE_URL` e `MIGRATION_DATABASE_URL` da API apontam para o mesmo destino; o serviço Railway `Postgres` é usado pela Evolution API, não pela API KÔMA. Redis Railway atende ao cache da Evolution API. Não mover bancos nem aumentar réplicas nesta missão.
- Backup do banco KÔMA: Railway `Postgres S3 Backup` aponta para o mesmo destino da API, cron `0 3 * * *` UTC, upload S3. Rodar `node scripts/check-backup-freshness.mjs` em sessão Railway autenticada; o gate exige conclusão, validação do arquivo, tamanho positivo, upload e idade menor que 36 horas. Nenhum segredo é registrado.
- Cobertura separada: o gate acima verifica o Supabase, não o Postgres Railway usado pela Evolution API. Em 09/10/2026, o S3 tinha dez cópias diárias; PITR Railway estava desativado e a interface exigia plano Pro para criar backups nativos. Não fazer upgrade, reiniciar bancos ou remover volumes para resolver esse limite. Registrar cópia independente e ensaio do banco Evolution antes de considerá-lo protegido.
- Recuperação: ver o escopo e as limitações do ensaio pós-STS em `post-sts-reliability-tracker.md`. Arquivo válido e upload recente não equivalem a recuperação integral de banco, mídias, configuração e agentes.
- Smoke público: `.github/workflows/production-smoke.yml`, diário e manual, somente GET/OPTIONS.

### Orçamento de conexões verificado em 2026-10-03

O runtime usa o pool de sessão Supabase (porta 5432), com QueuePool de quatro
conexões e overflow zero. Além desse pool, há uma conexão LISTEN operacional,
uma de chat e, quando há agente inscrito, uma de wakeup de impressão. O teto é
sete conexões por processo; duas versões em rolling deploy podem ocupar 14.
Migrações usam porta 6543. Homologação tem banco distinto.

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

O frontend Railway `Frontend` e os jobs `purge-runner`, `pre-purge-copy-runner` e `pre-purge-copy-job` foram excluídos após confirmação específica. O serviço e bucket `pre-purge-backup-20260916` ficam preservados como cópia histórica; não os excluir sem validar retenção e obter confirmação. Nunca aplicar patches Railway antigos em bloco; conferir diff, zerar mudanças obsoletas e confirmar `stagedChanges=null` antes de novos deploys.
