# 🍽️ KÔMA — Sistema de Gestão para Restaurantes & Bistrôs (SaaS Multi-Tenant)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg?style=for-the-badge)](LICENSE)

O **KÔMA** é uma plataforma SaaS multi-tenant em desenvolvimento para a gestão de restaurantes, bistrôs, lanchonetes e operações de food service. O sistema reúne Frente de Caixa (PDV), Gestão de Mesas e Comandas, Cozinha (KDS), Cardápio Digital Whitelabel, Painel de Logística/Delivery e Spooler de Impressão Térmica. A disponibilidade e a maturidade de cada integração variam; consulte [Status do Projeto](#-status-do-projeto).

---

## 🚀 Visão Geral do Produto

O objetivo do KÔMA é reduzir a fragmentação de sistemas em estabelecimentos de alimentação, reunindo os fluxos operacionais em uma arquitetura em nuvem multi-tenant.

- **Operação de Salão & Caixa**: Agilidade no atendimento de mesas e comandas com fechamento cego de caixa.
- **Autoatendimento & Delivery**: Cardápio digital direto no navegador do cliente sem necessidade de baixar aplicativos.
- **Engajamento & WhatsApp**: Fluxo de identificação por OTP e notificações projetado para a Meta WhatsApp Cloud API oficial, condicionado à configuração e aprovação do provedor.
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
- **Meta WhatsApp Cloud API Oficial**: Integração prevista via `graph.facebook.com`, dependente de credenciais, templates e aprovação válidos.
- Login de clientes no cardápio digital via código OTP de 6 dígitos enviado ao WhatsApp.
- Envio automático de status do pedido (*Em Preparo*, *Pronto para Retirada*, *Saiu para Entrega*, *Recusado*).
- Handshake de validação de Webhook integrado e verificado.

### 🍳 KDS (Kitchen Display System / Monitor de Cozinha)
- Kanban de produção de pratos com atualização em tempo real via WebSockets.
- Cronômetro visual por pedido em 3 faixas de alerta (Verde, Amarelo e Vermelho).
- Botão "Pedido Pronto" com notificação instantânea ao cliente e ao caixa.

### 🛵 PWA do Entregador & Logística
- Interface web progressiva (`/entregador?token=xxx`) para motoboys.
- Autenticação por token com revogação e limite de requisições nos fluxos implementados.
- Integração direta com Waze e Google Maps para navegação até o endereço de entrega.

### 🖨️ Agente de Impressão Térmica
- Spooler nativo em Python (`print-agent`) para impressoras térmicas USB ou de rede.
- Impressão automática por setor (cozinha, bar, balcão) e corte de papel.

### 💳 SmartPOS
- Fluxo F1–F12 para contexto do operador, pedidos, `PaymentIntent`, idempotência, liquidação, split, cancelamento e recuperação manual.
- Bridge Android de desenvolvimento com terminal simulado e reconciliação segura após retry/reinício.
- A integração real PagBank/PlugPag, o estorno no adquirente e a homologação física ainda são gates obrigatórios da Fase A.

### 🛡️ Multi-Tenant, Segurança e Privacidade
- Escopo de dados por restaurante (`restaurante_id`) na aplicação e políticas de Row Level Security (RLS) no PostgreSQL onde configuradas.
- Criptografia Fernet em campos e fluxos que a implementam explicitamente; isso não equivale a cifrar todo dado pessoal do sistema.
- Autenticação por JWT e controle de acessos por perfil (admin, caixa, garçom) nos fluxos implementados.

Esses controles precisam ser verificados por ambiente e não representam, isoladamente, certificação de segurança ou conformidade integral com a LGPD.

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
│ (RLS por ambiente) │       │  (Cloud API / OTP) │       │   Python USB/Rede  │
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
- **Alvo de produção**: PostgreSQL gerenciado; região e políticas RLS devem ser verificadas por ambiente
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

- **Node.js**: versão 22 ou superior
- **Python**: versão 3.12
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

# Executar a aplicação backend a partir da raiz do repositório
python -m uvicorn app.main:app --app-dir backend --reload --port 8000
```
O backend estará acessível em `http://localhost:8000` e a documentação Swagger em `http://localhost:8000/docs`.

### 3. Configurar o Frontend (React + Vite)
Em um novo terminal:
```bash
# Instalar exatamente as dependências registradas no lockfile
npm ci

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
META_VERIFY_TOKEN="SEU_TOKEN_DE_VERIFICACAO_META"
META_APP_SECRET="SEU_APP_SECRET_META"
META_PHONE_NUMBER_ID="SEU_PHONE_NUMBER_ID_META"
META_ACCESS_TOKEN="SEU_TOKEN_DE_ACESSO_META"

# Impressão Térmica
SIMULATE_PRINTER="True"
PRINTER_NAME="Generic / Text Only"

# SmartPOS: "pagbank_simulator" é somente desenvolvimento/teste
KOMA_SMARTPOS_PROVIDER="disabled"
```

---

## 🏢 Arquitetura Multi-Tenant (RLS)

O KÔMA utiliza uma arquitetura multi-tenant por isolamento de registros baseada em `restaurante_id`:

- **Nível da Aplicação**: Requests autenticados devem carregar o `restaurante_id` no contexto da requisição FastAPI (`current_restaurante_id`), e as consultas devem aplicar esse escopo.
- **Nível do Banco de Dados**: A arquitetura prevê **Row Level Security (RLS)** no PostgreSQL e sessões vinculadas com `SET LOCAL app.current_restaurante_id`.

O isolamento efetivo depende da configuração do banco, das migrações e de cada consulta. Ele deve ser coberto por testes de autorização entre tenants antes de cada liberação.

---

## 🧪 Testes Automatizados & Qualidade

O backend possui uma suíte isolada em SQLite para regressão local. O smoke operacional B1.4 usa PostgreSQL 17 efêmero em workflow próprio e não é substituído silenciosamente por SQLite.

```bash
# Instalar dependências de desenvolvimento do backend
python -m pip install -r backend/requirements-dev.txt

# Executar a suíte completa local; o conftest cria e remove o banco isolado
python -m pytest backend/tests -q

# Executar o recorte crítico usado pelo Quality Gate
bash scripts/regression_check.sh

# Verificar tipos, dependências e build do frontend
npm run lint
npm audit --audit-level=high
npm run build
```

---

## 🌐 Topologia de Deploy Prevista

- **Frontend**: Cloudflare Pages, com build conectado à branch `main` quando habilitado no ambiente.
- **Backend**: Railway como contêiner Python/FastAPI.
- **Banco de Dados**: PostgreSQL gerenciado, com migrações via Alembic.

Este diagrama de implantação não constitui evidência de alta disponibilidade, homologação ou prontidão para produção. A configuração efetiva deve ser validada no provedor e nos gates de release.

---

## 🔒 Segurança & LGPD

- **Criptografia**: Fernet é aplicado somente nos modelos e fluxos que o implementam e que recebem uma chave válida. Não se presume criptografia integral de toda PII.
- **Segredos**: Credenciais pertencem ao gerenciador de segredos de cada ambiente e nunca devem ser copiadas para código, documentação, logs ou fixtures.
- **Histórico público**: O histórico do repositório já conteve credenciais e artefatos sensíveis. A remoção do branch atual não revoga credenciais nem elimina cópias históricas; os valores afetados devem ser rotacionados/revogados antes de uma sanitização coordenada do histórico.
- **Privacidade**: Controles técnicos não substituem inventário de dados, base legal, transparência, retenção, atendimento a titulares e avaliação de fornecedores.
- **Webhooks**: Endpoints públicos devem validar assinatura/autenticidade, replay e escopo de tenant conforme o provedor; um handshake de verificação, sozinho, não autentica eventos posteriores.

Falhas de segurança não devem ser publicadas em issues. Consulte [SECURITY.md](SECURITY.md) para o processo de reporte privado e resposta a incidentes.

---

## 📄 Licença e Propriedade Intelectual

© 2026 **Georlan** — Todos os direitos reservados.

O arquivo [LICENSE](LICENSE) registra a licença proprietária adotada neste repositório. Ela se aplica somente ao material que o titular tem direito de licenciar e não substitui licenças de terceiros, licenças por arquivo, direitos sobre contribuições ou licenças que já tenham sido concedidas em revisões anteriores.

Este é um repositório público. Sua disponibilidade para leitura não deve ser descrita como confidencialidade ou segredo industrial, nem resolve por si só a titularidade de código, marcas, imagens, vídeos, apresentações ou outros ativos. Proveniência, autorizações e cessões devem ser documentadas separadamente.

**Componentes e arquivos de terceiros** permanecem sujeitos às suas respectivas licenças, detalhadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Cabeçalhos SPDX existentes, inclusive `Apache-2.0`, devem ser preservados até que a proveniência e os direitos aplicáveis sejam verificados. Logos, imagens e mockups são controlados pelo [registro de proveniência de ativos](ASSET_PROVENANCE.md).

> **Histórico documentado:** o commit `0901cc9ef75f138845a6d32b681388ebf0f9225b` introduziu uma licença MIT em 2026-08-03. O commit `396f16bfd2fa5a252dd91bdda2e8add28b7f7bd5` adotou o arquivo de licença proprietária em 2026-08-06. A alteração posterior não apaga permissões já concedidas para revisões efetivamente distribuídas sob MIT.

Veja [LICENSE](LICENSE) e [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) antes de usar ou distribuir qualquer parte do projeto. Esta seção registra o estado documental do repositório e não substitui revisão jurídica.

---

## 🟢 Status do Projeto

O KÔMA está em **desenvolvimento ativo**. Este README não declara o sistema pronto para uso profissional ou homologado para produção. Cada release deve passar pelos testes automatizados, revisão de segurança, validação de isolamento multi-tenant, migrações, backup/restore, observabilidade, privacidade e revisão das integrações externas.

O SmartPOS permanece restrito a desenvolvimento/testes com terminal simulado. Integração real PagBank/PlugPag, estorno no adquirente, homologação física, requisitos contratuais e validações financeiras/fiscais são gates obrigatórios antes da ativação comercial.
