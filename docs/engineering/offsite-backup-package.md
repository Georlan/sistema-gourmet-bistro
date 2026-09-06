# Pacote criptografado para backup off-site

Este procedimento reduz a parte operacional do Gate de backup externo sem transformar o GitHub em cofre e sem criar outro caminho de dump do banco.

A fonte continua sendo `scripts/manual_database_backup.py`. O utilitário `scripts/offsite_backup_package.py` recebe uma pasta `koma-*` já gerada, confere o SHA-256 de `application.dump` contra `manifest.json` e só então cria um pacote criptografado para transporte.

## Propriedades de segurança

- não conecta ao banco e não altera produção;
- recusa um dump cujo SHA-256 não corresponda ao manifesto;
- usa `age` com recipient público e criptografia autenticada;
- o `tar.gz` em claro é enviado em streaming para o `age` e não é gravado como arquivo temporário;
- nunca recebe a identidade/chave privada do `age`;
- não sobrescreve silenciosamente um pacote externo existente;
- falha de criptografia remove a saída parcial;
- gera SHA-256 do arquivo criptografado para conferir a cópia depois de movê-la;
- gera metadados sem segredos, incluindo o hash do dump de origem e se o manifesto de origem estava marcado como `restore_tested`.

A CLI oficial do `age` aceita `--recipient`, `--output` e entrada via stdin. Consulte a documentação upstream antes de instalar binários: <https://github.com/FiloSottile/age>.

## 1. Preparar uma identidade de recuperação

Em um computador confiável com `age` instalado, gere a identidade uma única vez:

```text
age-keygen -o CAMINHO_PRIVADO/koma-backup.agekey
```

O arquivo criado é **secreto**. Não o envie por chat, não o coloque no GitHub, não o mantenha junto da única cópia do backup e não o salve no computador do restaurante como única fonte de recuperação.

Extraia apenas o recipient público:

```text
age-keygen -y CAMINHO_PRIVADO/koma-backup.agekey
```

O valor público retornado (`age1...`) pode ser usado no comando de empacotamento. O script não precisa e não aceita a chave privada.

## 2. Gerar o backup canônico do banco

Siga `docs/engineering/manual-backup-and-release.md` e gere a pasta com:

```text
python scripts/manual_database_backup.py --output-dir CAMINHO_DA_PASTA_SEGURA
```

A pasta produzida contém `application.dump` e `manifest.json`. Não edite o manifesto para fazer uma verificação passar.

## 3. Criar o pacote criptografado

```text
python scripts/offsite_backup_package.py pack \
  --backup-dir CAMINHO_DA_PASTA_SEGURA/koma-AAAA... \
  --output-dir CAMINHO_DE_SAIDA \
  --recipient age1RECIPIENT_PUBLICO
```

A operação produz três arquivos:

- `koma-....tar.gz.age` — dump + manifesto criptografados;
- `koma-....tar.gz.age.sha256` — checksum da saída criptografada;
- `koma-....tar.gz.age.metadata.json` — proveniência não sensível do pacote.

Se algum desses nomes já existir, o utilitário recusa sobrescrever. Isso evita apagar silenciosamente uma cópia anterior.

## 4. Copiar para fora do computador

Copie os **três arquivos** para mídia ou armazenamento externo ao computador do restaurante. A cópia só conta como off-site quando perder o computador local não elimina também essa cópia.

Não use GitHub como destino do backup, mesmo criptografado.

## 5. Conferir a cópia externa

Execute a verificação apontando para os arquivos **no destino externo**, e não para os originais locais:

```text
python scripts/offsite_backup_package.py verify \
  --package CAMINHO_EXTERNO/koma-....tar.gz.age \
  --checksum CAMINHO_EXTERNO/koma-....tar.gz.age.sha256
```

O comando precisa terminar com:

```text
SHA-256 conferido: cópia externa idêntica ao pacote preparado.
```

Se o hash não conferir, descarte a cópia defeituosa e repita a transferência a partir de uma origem válida.

## Recuperação

Em uma máquina confiável que possua a identidade privada correta, a etapa de recuperação começa descriptografando o pacote:

```text
age --decrypt -i CAMINHO_PRIVADO/koma-backup.agekey \
  --output koma-backup.tar.gz \
  koma-....tar.gz.age
```

Depois de extrair, confira novamente o `manifest.json` e siga o ensaio de restauração em **banco novo, isolado e descartável** descrito no runbook principal. Nunca use o processo de recuperação como atalho para restaurar diretamente sobre produção.

## O que este pacote não cobre

Este utilitário protege somente o backup canônico do banco (`public` + `koma_internal`) e seu manifesto. Ele **não** copia automaticamente:

- imagens do Supabase Storage;
- variáveis/segredos do Railway e a `ENCRYPTION_KEY`;
- journals/configuração do agente de impressão;
- volumes de Redis/Evolution API;
- a própria identidade privada do `age`.

Portanto, a existência de um `.age` válido **não fecha sozinha o Gate 2**. O Gate só fica verde quando houver a cópia real fora do computador, hash conferido no destino e os demais itens de recuperação aplicáveis preservados conforme o runbook principal.
