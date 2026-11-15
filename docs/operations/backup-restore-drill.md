# Exercício de restauração do backup PostgreSQL

Este procedimento comprova uma restauração em um PostgreSQL descartável local.
Nunca execute `pg_restore` contra Railway ou qualquer banco de produção. O
serviço `Postgres S3 Backup` estar implantado não comprova que há um objeto
recente nem que ele é restaurável.

## Pré-requisitos e escolha do arquivo

1. Confirme no armazenamento configurado para `Postgres S3 Backup` o bucket,
   a política de retenção e o objeto mais recente. Registre nome, horário,
   tamanho e checksum sem copiar credenciais para o relatório.
2. Baixe o arquivo apenas para uma máquina controlada, com disco criptografado
   e acesso restrito. O dump contém dados pessoais de produção. Não faça upload
   em CI, PR, issue ou armazenamento temporário público.
3. Se usar `scripts/manual_database_backup.py`, escolha o
   `application.dump` cujo `manifest.json` corresponda ao SHA-256 do arquivo.
   Se usar o pacote off-site, verifique antes com
   `python scripts/offsite_backup_package.py verify --package CAMINHO --checksum CAMINHO`
   e descriptografe somente no ambiente controlado.

## Restaurar em banco descartável

Para backups Railway com extensão supabase_vault use a imagem compatível com a origem, atualmente supabase/postgres:17.6.1.141. A imagem postgres:17 padrão não contém essa extensão; além disso, nessa imagem Supabase o papel postgres não é superusuário: use supabase_admin somente dentro do container descartável e crie o papel aplicativo koma_app NOLOGIN apenas nesse container.

O exemplo abaixo utiliza rede desativada, nenhum mapeamento de porta e PGDATA em tmpfs (memória, não volume persistente). O arquivo de origem deve estar em local controlado; alternativamente, use um cliente S3 autenticado no processo Railway existente para transmitir o objeto em memória, sem salvar dump em disco. Nunca envie o dump para GitHub Actions, issues, PRs ou este chat.

~~~bash
export KOMA_DRILL_DUMP=/caminho/controlado/backup.tar.gz
test -f "$KOMA_DRILL_DUMP"
docker container inspect koma-restore-drill >/dev/null 2>&1 && exit 1
docker run --detach --rm --name koma-restore-drill \
  --network none --tmpfs /var/lib/postgresql/data:rw,size=1g \
  --env POSTGRES_PASSWORD=drill-only-password \
  supabase/postgres:17.6.1.141
# A imagem Supabase reinicia um servidor temporário durante o bootstrap.
# Aguarde a inicialização FINAL, não apenas o primeiro pg_isready.
sleep 25
docker exec koma-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc 'SELECT 1'
docker exec koma-restore-drill createdb -U postgres koma_restore_drill
docker exec koma-restore-drill psql -U supabase_admin -d postgres \
  -v ON_ERROR_STOP=1 -c 'CREATE ROLE koma_app NOLOGIN'
set -o pipefail
gzip -dc "$KOMA_DRILL_DUMP" | docker exec -i koma-restore-drill pg_restore \
  -F t -U supabase_admin --no-owner --no-acl --exit-on-error \
  --dbname=koma_restore_drill
~~~

O comando de restore acima é específico do arquivo tar comprimido em gzip produzido pelo serviço atual. Para dumps customizados por scripts próprios, confirme o formato com pg_restore antes de usar outra opção. Nunca use --clean, --create ou uma string de conexão remota; NÃO execute nada contra produção. Não ignore erro de extensão, papel, índice, constraint ou policy para declarar sucesso.

## Conferir integridade e leitura

Execute as consultas agregadas abaixo apenas dentro do container isolado. Não extraia nomes, e-mails, telefones ou registros de pedidos.

~~~bash
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc 'SELECT version_num FROM public.alembic_version'
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_policies WHERE schemaname NOT IN ('pg_catalog','information_schema')"
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity"
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_constraint WHERE contype='f'"
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_indexes WHERE schemaname='public'"
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM public.restaurantes"
docker exec koma-restore-drill psql -U supabase_admin -d koma_restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_extension WHERE extname='supabase_vault'"
docker stop koma-restore-drill  # O container é --rm e os dados em tmpfs são descartados
~~~

Registre hash SHA-256 do objeto, horário, origem, imagem, resultado do pg_restore e contagens sem PII. A restauração estrutural NÃO comprova sozinha funcionamento completo do backend, credenciais reais, ACLs, Redis, mídias ou operação multi-tenant. Um teste adicional de leitura pelo backend pode ser planejado em ambiente isolado que preserve essas dependências, sem expor porta pública ou usar conexões de produção.

## Cobertura, monitoramento e estado de validação (15/11/2026)

- **Origem e destino ativos:** `Postgres S3 Backup` (Railway, cron `0 3 * * *` UTC) executa `pg_dump` do PostgreSQL principal (Supabase) e envia `.tar.gz` para o bucket Railway `pre-purge-backup-20260916` (`sjc` / `t3.storageapi.dev`), com retenção `MAX_BACKUPS=10` (10 arquivos diários de `2026-11-06` a `2026-11-15`, ~2,0–2,4 MB cada).
- **Não cobertos por esta rotina:** PostgreSQL auxiliar da Evolution API (Railway), Redis (Railway) e arquivos do Supabase Storage (`cardapio-assets`, `koma-legacy-archives`). O plano Supabase Free não inclui backups agendados nem PITR nativos.
- **Monitoramento automático:** `.github/workflows/backup-freshness-monitor.yml` executa `node scripts/check-backup-freshness.mjs --github-issue` diariamente às `05:00 UTC` e sob demanda (`workflow_dispatch`), abrindo/fechando a issue `[KÔMA] Falha no monitor de backup` sem duplicar alertas.
  - **Passo de ativação no GitHub Actions:** cadastrar o secret `RAILWAY_TOKEN` (com permissão de leitura de logs do projeto `passionate-truth`) em *Settings → Secrets and variables → Actions*. Sem esse secret, o workflow falha explicitamente (sem falso verde).
- **Restauração isolada em 15/11/2026 — VALIDADA para o PostgreSQL principal:** objeto S3 de `03:01:22 UTC` (2.387.236 bytes, SHA-256 `df3ffa4b3b761757af6969b92c64b0c291a3bcbfda4b49cdd8438e1fd487213a`) foi transmitido em memória pelo terminal Railway autenticado, descomprimido e restaurado com `pg_restore` **exit code 0** em `supabase/postgres:17.6.1.141` isolado (`--network none`, PGDATA tmpfs, nenhuma porta exposta). O papel `koma_app NOLOGIN` foi criado **somente** no container; o restore usou `supabase_admin`. Conferência: 126 tabelas públicas, 166 policies, 119 tabelas com RLS habilitado, 273 chaves estrangeiras, 537 índices, 5 restaurantes (contagem agregada), Alembic `c6a1d2e3f4b5`, extensão `supabase_vault` presente. Container removido. **Limitado à restauração estrutural e leitura SQL**: não houve teste de inicialização do backend nem recuperação de Storage/Redis/PostgreSQL Evolution.
