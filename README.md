# 🍽️ KÔMA — Sistema de Gestão para Restaurantes & Bistrôs (SaaS Multi-Tenant)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg?style=for-the-badge)](LICENSE)

O **KÔMA** é uma plataforma SaaS multi-tenant moderna desenvolvida para a gestão completa de restaurantes, bistrôs, lanchonetes e operações de food service. O sistema integra Frente de Caixa (PDV), Gestão de Mesas e Comandas, Cozinha (KDS), Cardápio Digital Whitelabel com OTP via WhatsApp, Painel de Logística/Delivery com PWA para entregadores e Spooler de Impressão Térmica.

---

## 🚀 Visão Geral do Produto

O KÔMA resolve o desafio da fragmentação de sistemas em estabelecimentos de alimentação, unificando toda a operação em uma arquitetura em nuvem segura, ágil e multi-tenant.

- **Operação de Salão & Caixa**: Agilidade no atendimento de mesas e comandas com fechamento cego de caixa.
- **Autoatendimento & Delivery**: Cardápio digital direto no navegador do cliente sem necessidade de baixar aplicativos.
- **Engajamento & WhatsApp**: Identificação de clientes via código OTP no WhatsApp (Meta Cloud API oficial) e envio automático de atualizações de status do pedido.
- **Cozinha Inteligente (KDS)**: Kanban de produção com cronômetros visuais por pedido e setorização de pratos.
- **Logística Integrada**: Portal PWA otimizado para motoboys acompanharem entregas com rota direta no Waze/Google Maps.

---

## ⭐ Principais Funcionalidades

### 🛒 PDV & Gestão de Caixa
- Abertura e fechamento de turno de caixa com conferência cega.
- Lançamentos de suprimento, sangria e relatórios de fluxo financeiro.
- Venda direta ao balcão, comandas e mesas.

### 🍽️ Salão, Mesas & Comandas
- Controle de mesas ocupadas, livres e em pagamento.
- Leitura de QR Code por mesa com vinculação automática.
- Mesclagem de comandas e divisão proporcional ou livre de pagamentos.

### 📱 Cardápio Digital Whitelabel
- URL pública dinâmica por estabelecimento (`/c/:slug`).
- Personalização de marca (logo, banner e identidade visual).
- Carrossel de múltiplas fotos por produto, variações e adicionais.
- Campo de observações de itens e recado no carrinho salvo no pedido e impresso no cupom.

### 🔐 Autenticação OTP & Notificações por WhatsApp
- **Meta WhatsApp Cloud API Oficial**: Disparo direto de mensagens via `graph.facebook.com`.
- Login de clientes no cardápio digital via código OTP de 6 dígitos enviado ao WhatsApp.
- Envio automático de status do pedido (*Em Preparo*, *Pronto para Retirada*, *Saiu para Entrega*, *Recusado*).
- Handshake de validação de Webhook integrado e verificado.

### 🍳 KDS (Kitchen Display System / Monitor de Cozinha)
- Kanban de produção de pratos com atualização em tempo real via WebSockets.
- Cronômetro visual por pedido em 3 faixas de alerta (Verde, Amarelo e Vermelho).
- Botão "Pedido Pronto" com notificação instantânea ao cliente e ao caixa.

### 🛵 PWA do Entregador & Logística
- Interface web progressiva (`/entregador?token=xxx`) para motoboys.
- Autenticação por token seguro com revogação e limite de requisições.
- Integração direta com Waze e Google Maps para navegação até o endereço de entrega.

### 🖨️ Agente de Impressão Térmica
- Spooler nativo em Python (`print-agent`) para impressoras térmicas USB ou de rede.
- Impressão automática por setor (cozinha, bar, balcão) e corte de papel.

### 🛡️ Multi-Tenant & Segurança (LGPD)
- Isolamento rígido de dados por restaurante (`restaurante_id`) com Row Level Security (RLS) no PostgreSQL.
- Criptografia Fernet para dados sensíveis de clientes (PII).
- Tokens JWT sanitizados e controle de acessos por perfil (admin, caixa, garçom).

---

## 🛠️ Arquitetura & Stack Tecnológico

```
                           ┌─────────────────────────┐
                           │   Cloudflare Pages      │
                           │ React + Vite + Tailwind │
                           └────────────┬────────────┘
                                        │
                                        ▼ (HTTPS / WSS)
                           ┌─────────────────────────┐
                           │      Railway App        │
                           │   FastAPI (Python 3.12) │
                           └────────────┬────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌────────────────────┐       ┌────────────────────┐       ┌────────────────────┐
│ Supabase PostgreSQL│       │ Meta WhatsApp API  │       │ Agente Impressão   │
│   (RLS Enabled)    │       │  (Cloud API / OTP) │       │   Python USB/Rede  │
└────────────────────┘       └────────────────────┘       └────────────────────┘
```

### Frontend
- **Framework**: React 19 + TypeScript + Vite
- **Estilização**: Tailwind CSS v4
- **Componentes & Animações**: Lucide React, Framer Motion
- **Deploy**: Cloudflare Pages

### Backend
- **Framework**: FastAPI (Python 3.12)
- **ORM & Banco**: SQLAlchemy 2.0 + Alembic
- **Serviço HTTP**: HTTPX (Integração Meta Cloud API & Evolution API)
- **Deploy**: Railway

### Banco de Dados & Infraestrutura
- **Produção**: PostgreSQL (Supabase us-west-2) com RLS ativado
- **Desenvolvimento Local**: SQLite (`bistro.db`)
- **Mensageria & Notificações**: WebSockets + Meta Cloud API Webhook Handshake

---

## 📂 Estrutura de Pastas

```
sistema-gourmet-bistro/
├── src/                        # Código-fonte do Frontend (React)
│   ├── components/             # Componentes reutilizáveis (PDV, KDS, Modais, Cardápio)
│   ├── pages/                  # Páginas da aplicação (Cardápio, Caixa, Entregador, Admin)
│   ├── services/               # Clientes de API e comunicação com o backend
│   └── types/                  # Definições de tipos TypeScript
├── backend/                    # API FastAPI e serviços do Backend
│   ├── app/
│   │   ├── routes/             # Endpoints HTTP (orders, cardapio, whatsapp_webhook, etc.)
│   │   ├── services/           # Regras de negócio (whatsapp, clientes, customer_auth)
│   │   ├── models.py           # Modelos SQLAlchemy (Comanda, Produto, Cliente, etc.)
│   │   ├── config.py           # Configurações do ambiente e validações
│   │   └── main.py             # Ponto de entrada do FastAPI e middlewares
│   ├── alembic/                # Migrações de banco de dados
│   └── tests/                  # Suíte de testes automatizados com Pytest
├── print-agent/                # Agente local de impressão térmica (Python)
├── supabase/                   # Scripts SQL e políticas de Row Level Security (RLS)
├── infra/                      # Configurações de infraestrutura e serviços auxiliares
├── public/                     # Assets estáticos públicos
├── .env.example                # Modelo de variáveis de ambiente
├── package.json                # Dependências do frontend Node.js
└── README.md                   # Documentação do projeto
```

---

## 📋 Pré-requisitos

Antes de iniciar, certifique-se de ter instalado em sua máquina:

- **Node.js**: versão 18.0.0 ou superior
- **Python**: versão 3.10 ou superior (Python 3.12 recomendado)
- **Git**: para clonagem do repositório

---

## 💻 Como Rodar Localmente

### 1. Clonar o Repositório
```bash
git clone https://github.com/Georlan/sistema-gourmet-bistro.git
cd sistema-gourmet-bistro
```

### 2. Configurar o Backend (FastAPI)
```bash
# Criar ambiente virtual
python3 -m venv .venv
source .venv/bin/activate  # No Windows: .venv\Scripts\activate

# Instalar dependências
pip install -r backend/requirements.txt

# Configurar variáveis de ambiente
cp .env.example .env

# Executar a aplicação backend
uvicorn app.main:app --reload --port 8000
```
O backend estará acessível em `http://localhost:8000` e a documentação Swagger em `http://localhost:8000/docs`.

### 3. Configurar o Frontend (React + Vite)
Em um novo terminal:
```bash
# Instalar dependências do Node.js
npm install

# Iniciar servidor de desenvolvimento
npm run dev
```
O frontend estará acessível em `http://localhost:3000`.

---

## ⚙️ Variáveis de Ambiente (`.env`)

Copie o arquivo `.env.example` para `.env` e preencha as variáveis de acordo com o ambiente:

```env
# Banco de Dados
DATABASE_URL="sqlite:///./bistro.db"

# Chaves de Segurança & Criptografia
SECRET_KEY="SUA_CHAVE_SECRET_KEY_ALEATORIA"
ENCRYPTION_KEY="SUA_CHAVE_FERNET_ENCRYPTION_KEY"

# Meta Cloud API (WhatsApp Oficial)
META_VERIFY_TOKEN="1505"
META_PHONE_NUMBER_ID="1206090279260222"
META_ACCESS_TOKEN="SEU_TOKEN_DE_ACESSO_META"

# Impressão Térmica
SIMULATE_PRINTER="True"
PRINTER_NAME="Generic / Text Only"
```

---

## 🏢 Arquitetura Multi-Tenant (RLS)

O KÔMA utiliza uma arquitetura multi-tenant por isolamento de registros baseada em `restaurante_id`:

- **Nível da Aplicação**: Todo request autenticado carrega o `restaurante_id` no contexto da requisição FastAPI (`current_restaurante_id`), garantindo que nenhuma consulta acesse registros de outros estabelecimentos.
- **Nível do Banco de Dados**: No PostgreSQL (Supabase), as tabelas possuem **Row Level Security (RLS)** ativado. As queries de cada tenant utilizam sessões vinculadas com `SET LOCAL app.current_restaurante_id`.

---

## 🧪 Testes Automatizados & Qualidade

O backend possui uma suíte abrangente de testes cobrindo isolamento multi-tenant, idempotência de pedidos, cálculo de caixa e envio de OTP por WhatsApp:

```bash
# Executar a suíte completa de testes no backend
SECRET_KEY=dev_secret_key ENCRYPTION_KEY=32_bytes_dev_encryption_key_123 ./.venv/bin/pytest backend/tests/ -v

# Verificar compilação do frontend
npm run build

# Verificar sintaxe dos serviços Python
python3 -m py_compile backend/app/services/whatsapp.py
```

---

## 🌐 Deploy em Produção

- **Frontend**: Hospedado no **Cloudflare Pages** com build automático conectado à branch `main`.
- **Backend**: Hospedado no **Railway** como contêiner Python FastAPI em alta disponibilidade.
- **Banco de Dados**: Instância gerenciada **PostgreSQL no Supabase** (região US West) com migrações gerenciadas via Alembic.

---

## 🔒 Segurança & LGPD

- **Dados Sensíveis (PII)**: Nomes e números de telefone de clientes são tratados com criptografia at-rest via biblioteca `cryptography` (Fernet).
- **Sem Exposição de Segredos**: O repositório não armazena chaves privadas, senhas ou tokens no histórico do Git.
- **Validação de Webhook**: O endpoint do Webhook da Meta implementa a verificação por handshake via token seguro (`hub.verify_token`).

---

## 📄 Licença e Propriedade Intelectual

© 2026 **Georlan** — Todos os direitos reservados.

Este Software é **proprietário e confidencial**. O código-fonte, design, arquitetura e documentação são protegidos por lei. É proibido copiar, distribuir, modificar, sublicenciar, revender ou utilizar este Software para criar produto concorrente sem autorização escrita.

Clientes com **assinatura ativa** recebem permissão limitada, não exclusiva e intransferível para utilizar o serviço pelo período contratado.

**Componentes de terceiros** (React, FastAPI, Supabase SDK, etc.) permanecem sujeitos às suas respectivas licenças, detalhadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

> **Nota histórica:** Versões do projeto disponibilizadas anteriormente a 2026-08-06 sob licença MIT permanecem sujeitas aos termos daquela licença. A licença proprietária aplica-se somente a versões e modificações distribuídas a partir dessa data.

Veja o arquivo [LICENSE](LICENSE) para o texto completo da licença proprietária.

---

## 🟢 Status do Projeto

O KÔMA está em **desenvolvimento ativo e em uso operacional em produção**.
