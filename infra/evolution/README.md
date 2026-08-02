# Evolution API do Kôma

Infraestrutura mínima para o piloto controlado do Kôma. Ela usa a Evolution API
`2.3.7`, PostgreSQL e Redis, sem o Evolution Manager e sem integrações que o OTP
não utiliza.

## Teste local no Linux

Requisitos: Docker Engine com o plugin Docker Compose.

```bash
cd infra/evolution
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Use o primeiro valor em `POSTGRES_PASSWORD`, inclusive dentro de
`DATABASE_CONNECTION_URI`, e o segundo em `AUTHENTICATION_API_KEY`. Depois:

```bash
docker compose up -d
docker compose ps
```

No terminal raiz do Kôma, exporte a mesma URL, chave e o nome da instância:

```bash
export EVOLUTION_API_URL=http://localhost:8080
export EVOLUTION_API_KEY='CHAVE_GERADA'
export EVOLUTION_INSTANCE_NAME=koma-piloto
python3 scripts/evolution_bootstrap.py provision
```

O comando cria somente a instância ausente e grava o QR Code em
`evolution-qr.png`. Abra o arquivo e vincule um número secundário:

```bash
xdg-open evolution-qr.png
python3 scripts/evolution_bootstrap.py status
```

O estado esperado é `open`. Para um envio explícito de teste:

```bash
python3 scripts/evolution_bootstrap.py send-test --phone 5588999999999
```

## Implantação no Railway

Crie os três serviços no **mesmo projeto Railway do backend Kôma**:

1. Um PostgreSQL gerenciado chamado `evolution-postgres`.
2. Um Redis gerenciado chamado `evolution-redis`.
3. Um serviço por imagem Docker chamado `evolution-api`, usando
   `evoapicloud/evolution-api:v2.3.7`.

No serviço `evolution-api`, configure:

```env
SERVER_NAME=koma-evolution
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://DOMINIO_PUBLICO_DA_EVOLUTION
CORS_ORIGIN=https://sistema-gourmet-bistro.pages.dev
CORS_METHODS=GET,POST,PUT,DELETE
CORS_CREDENTIALS=true
LOG_LEVEL=ERROR,WARN,INFO
DEL_INSTANCE=false
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=${{evolution-postgres.DATABASE_URL}}?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=koma_evolution
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false
DATABASE_SAVE_IS_ON_WHATSAPP=false
DATABASE_DELETE_MESSAGE=true
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=${{evolution-redis.REDIS_URL}}
CACHE_REDIS_TTL=604800
CACHE_REDIS_PREFIX_KEY=koma
CACHE_REDIS_SAVE_INSTANCES=false
CONFIG_SESSION_PHONE_CLIENT=Koma
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
AUTHENTICATION_API_KEY=CHAVE_ALEATORIA_DE_48_BYTES
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
```

Gere um domínio público apontando para a porta `8080` e monte um volume
persistente em `/evolution/instances`. Após o deploy, execute localmente o
bootstrap usando o domínio público para criar a instância e abrir o QR Code.

Por fim, no serviço do backend Kôma, configure:

```env
EVOLUTION_API_URL=http://evolution-api.railway.internal:8080
EVOLUTION_API_KEY=CHAVE_ALEATORIA_DE_48_BYTES
EVOLUTION_INSTANCE_NAME=koma-piloto
```

As duas ocorrências da chave precisam ter exatamente o mesmo valor. Redeploy o
backend Kôma e faça o teste pelo cardápio digital.

## Segurança do piloto

- Use um número secundário, não o WhatsApp pessoal principal.
- Nunca coloque a chave real em `.env.example`, commit, print ou conversa.
- O modo Baileys usa WhatsApp Web e pode desconectar. Antes da venda comercial,
  migre o provedor para WhatsApp Cloud API oficial.
- Não exponha PostgreSQL ou Redis à internet; somente a porta HTTP da Evolution.
