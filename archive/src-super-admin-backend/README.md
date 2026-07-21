# SuperAdmin Cockpit Architecture & Deployment Guide (SaaS Solopreneur)

Este é o guia técnico completo e documentação do **SuperAdmin Cockpit** e do backend **FastAPI**, projetado para permitir que um único desenvolvedor (**Solopreneur**) gerencie com segurança mais de 100 restaurantes em uma infraestrutura multilocatária (multi-tenant) escalável, isolada e com monitoramento em tempo real.

---

## 🛠️ Stack Tecnológica de Infraestrutura

- **Frontend Console:** React 19 + TypeScript + Vite + Tailwind CSS.
- **Backend Core:** FastAPI (Python 3.11+) operando de forma 100% assíncrona.
- **Banco de Dados:** Supabase (PostgreSQL) com isolamento físico de banco via schemas PostgreSQL separados (`schema_tenant-name`).
- **Cache & Filas:** Redis (Armazenamento temporário de métricas do Railway e estados dos webhooks).
- **Log Centralizado (ELK):** Elasticsearch, Logstash, Kibana para auditoria e tracing.
- **Alertas Críticos:** Sentry API + Telegram Bot API enviando pushes diretamente para o seu celular privado.

---

## 🏗️ Padrões de Design & Arquitetura (FastAPI)

Para garantir que o código seja limpo, modular e de fácil manutenção, implementamos os seguintes padrões:

1. **Injeção de Dependência (DI):** Todos os serviços externos (`SupabaseService`, `CloudflareService`, `TelegramService`, `RailwayService`) são injetados nas rotas do FastAPI usando o mecanismo nativo `Depends()`. Isso permite a troca fácil de provedores de infraestrutura e viabiliza testes unitários isolados com mocks.
2. **Tratamento Global de Erros:** Um middleware intercepta todas as exceções HTTP e do sistema, enviando o log de trace completo (Sentry) e disparando imediatamente uma mensagem de alerta prioritária para o celular do desenvolvedor via Telegram.
3. **Cache Temporário no Redis:** As chamadas de monitoramento da API do Railway são salvas em cache local no Redis com TTL de 15 segundos para evitar estouro de limite de cota de chamadas de API (rate limit).

---

## ⚙️ Configuração do Ambiente e Chaves (.env)

Crie um arquivo `.env` na raiz do seu projeto de backend contendo as seguintes credenciais de infraestrutura:

```env
# JWT Session Security
JWT_SECRET="sua_chave_secreta_jwt_para_superadmin_koma"

# Supabase Credentials (PostgreSQL Multi-Tenant)
SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_ID].supabase.co:5432/postgres"
SUPABASE_SERVICE_ROLE_KEY="sua_chave_service_role_para_ignorar_rls"

# Cloudflare Routing (Subdomínios Automáticos)
CLOUDFLARE_API_TOKEN="seu_token_api_cloudflare_dns"
CLOUDFLARE_ZONE_ID="seu_zone_id_da_cloudflare"

# Railway Monitoring
RAILWAY_API_TOKEN="seu_token_api_railway"
RAILWAY_PROJECT_ID="seu_id_projeto_railway"

# Telegram Bot Alerts
TELEGRAM_BOT_TOKEN="token_do_seu_bot_gerado_no_botfather"
TELEGRAM_CHAT_ID="seu_chat_id_privado_obtido_via_userinfobot"

# Tracing
SENTRY_DSN="sua_dsn_do_sentry"
```

---

## 🚀 Como Inicializar com Docker Compose

O ambiente de desenvolvimento completo está orquestrado via Docker Compose, incluindo o backend em FastAPI, uma instância Redis de cache e a Stack ELK para logs agregados.

1. **Suba os containers:**
   ```bash
   docker-compose up --build -d
   ```

2. **Verifique os logs ativos:**
   ```bash
   docker-compose logs -f
   ```

3. **Acesse as portas do sistema localmente:**
   - **FastAPI Documentation (Swagger):** http://localhost:8000/docs
   - **Kibana (Visualizador de Logs ELK):** http://localhost:5601
   - **Redis Instance:** localhost:6379

---

## 🧪 Como Executar os Testes Unitários Automatizados

Para garantir que novos patches de código não quebrem a automação da infraestrutura, criamos uma suite de testes unitários isolados com Pytest:

1. **Instale as dependências locais:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Execute a suite de testes:**
   ```bash
   pytest -v SuperAdminTests.py
   ```

A suite valida com sucesso:
- Autenticação e assinatura de tokens JWT.
- Pipeline de Onboarding em 1-Clique (com mocks de Supabase DDL e Cloudflare DNS).
- Bloqueio Financeiro (Inadimplência) e envio correspondente do alerta no Telegram.
- Confirmação e bypass manual do terminal de erros de webhooks do Asaas.
