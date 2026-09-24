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

No diretório do repositório, defina o caminho absoluto do dump no shell. O
container abaixo é novo e só escuta em `127.0.0.1`; confira que o nome ainda
não existe antes de prosseguir.

```bash
export KOMA_DRILL_DUMP=/caminho/controlado/application.dump
test -f "$KOMA_DRILL_DUMP"
docker container inspect koma-restore-drill >/dev/null 2>&1 && exit 1
docker run --detach --name koma-restore-drill \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_PASSWORD=drill-only-password \
  postgres:17
docker exec koma-restore-drill sh -c 'until pg_isready -U postgres; do sleep 1; done'
docker exec koma-restore-drill createdb -U postgres koma_restore_drill
if [[ "$KOMA_DRILL_DUMP" == *.gz ]]; then
  set -o pipefail
  gzip -dc "$KOMA_DRILL_DUMP" | docker exec -i koma-restore-drill pg_restore \
    -F t -U postgres --no-owner --no-acl --exit-on-error \
    --dbname=koma_restore_drill
else
  docker cp "$KOMA_DRILL_DUMP" koma-restore-drill:/tmp/application.dump
  docker exec koma-restore-drill pg_restore -U postgres \
    --no-owner --no-acl --exit-on-error \
    --dbname=koma_restore_drill /tmp/application.dump
fi
```

Não use `--clean` nem reutilize um banco existente. O serviço `Postgres S3 Backup`
produz um `pg_dump` em formato tar comprimido com `gzip` (`.gz`). O comando
acima descomprime e envia o tar diretamente para `pg_restore`. A imagem
`postgres:17` padrão falhou ao recriar a extensão `supabase_vault` encontrada
no backup de 24/09/2026; para esse backup, substitua a imagem no comando
`docker run` por uma que tenha a mesma extensão e versão da origem.
Não exclua a extensão e não marque um restore parcial como comprovado. Nunca
execute `pg_restore` contra produção.

## Conferir integridade e leitura pelo backend

As consultas abaixo mostram somente contagens e versão de migration. Compare
as tabelas e contagens com o manifesto quando ele existir. Não exporte linhas
com nomes, e-mails, telefones ou pedidos para o relatório.

```bash
docker exec koma-restore-drill psql -U postgres -d koma_restore_drill \
  -v ON_ERROR_STOP=1 -Atc 'SELECT version_num FROM alembic_version'
docker exec koma-restore-drill psql -U postgres -d koma_restore_drill \
  -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','koma_internal')"
docker exec koma-restore-drill psql -U postgres -d koma_restore_drill \
  -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM restaurantes'
```

Com as dependências do backend instaladas, confirme que o modelo da aplicação
consegue ler o banco restaurado. O endereço abaixo aponta exclusivamente para
o container local.

```bash
DATABASE_URL=postgresql://postgres:drill-only-password@127.0.0.1:55432/koma_restore_drill \
PYTHONPATH=backend python -c \
  'from app.database import SessionLocal; from app.models import Restaurante; db=SessionLocal(); print("restaurantes:", db.query(Restaurante).count()); db.close()'
```

Registre data, origem e checksum do backup, versão PostgreSQL, extensões necessárias, head Alembic,
contagens sem PII, resultado da leitura pelo backend e responsável pelo teste.
Marque **restore comprovado** somente se todos os passos passarem. Ao terminar,
remova o container e apague o dump local conforme a política de retenção segura:

```bash
docker rm --force koma-restore-drill
```
