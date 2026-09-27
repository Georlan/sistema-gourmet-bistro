# Contrato de infraestrutura KÔMA · 2026-09-27

## Produção

- Frontend canônico: Cloudflare Pages `sistema-gourmet-bistro`, branch `main`, domínio `app.komafood.com.br`, fallback `sistema-gourmet-bistro.pages.dev`.
- API: Railway projeto `passionate-truth`, serviço `Kôma`, branch `main`, root `/backend`, região `sfo`, **1 réplica**. Build Railpack; start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; pre-deploy `alembic upgrade head`; watch `backend/**`; healthcheck `/health/ready`; `/health/live` público. Volume `/app/data` preservado.
- Banco autoritativo: Postgres do mesmo projeto Railway; Redis e Evolution API são serviços separados. Não mover banco nem aumentar réplicas nesta missão.
- Backup: Railway `Postgres S3 Backup`, cron `0 3 * * *` UTC, upload S3. Rodar `node scripts/check-backup-freshness.mjs` em sessão Railway autenticada; o gate exige conclusão, validação do arquivo, tamanho positivo, upload e idade menor que 36 horas. Nenhum segredo é registrado.
- Smoke público: `.github/workflows/production-smoke.yml`, diário e manual, somente GET/OPTIONS.

## Homologação

- Railway projeto `Koma Homologacao`, serviço `Koma`, root `/backend`, `sfo`, **2 réplicas**, healthcheck `/health/ready`.
- Ambiente isolado para `capacity:five-tenants`; não enviar email/WhatsApp real nem cobrar pagamentos reais.

## Alterações controladas

O frontend Railway `Frontend` e os jobs `purge-runner`, `pre-purge-copy-runner` e `pre-purge-copy-job` foram excluídos após confirmação específica. O serviço e bucket `pre-purge-backup-20260916` ficam preservados como cópia histórica; não os excluir sem validar retenção e obter confirmação. Nunca aplicar patches Railway antigos em bloco; conferir diff, zerar mudanças obsoletas e confirmar `stagedChanges=null` antes de novos deploys.
