# 🍔 KÔMA SaaS — Documento de Handoff & Contexto Completo

> **Versão:** 3.0 (Pós-Pacote 3 — Logística de Entregas & PWA Motoboy)  
> **Repositório:** `Georlan/sistema-gourmet-bistro` (Branch: `main`)  
> **Status dos Testes:** 60/60 Tests PASSED (100% OK) | Build Frontend: 0 Erros  
> **Roadmap:** 95% Concluído (19/20 Fases)

---

## 📐 1. Arquitetura e Tecnologias

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Lucide Icons (Deploy: Cloudflare Pages `sistema-gourmet-bistro.pages.dev`).
- **Backend**: Python 3.12 + FastAPI + SQLAlchemy + Pydantic (Deploy: Railway `sistema-gourmet-bistro-production.up.railway.app`).
- **Banco de Dados**: PostgreSQL no Supabase (`us-west-2`) com suporte a SQLite local (`bistro.db`) para desenvolvimento offline.
- **Isolamento Multi-Tenant**: Cada requisição e query é estritamente isolada por `restaurante_id` usando `ContextVar` (`current_restaurante_id`), RLS e schemas Pydantic validados.
- **Criptografia LGPD**: AES-256 (Fernet) para PII de clientes (`identificador`/nome, `delivery_telefone`, `delivery_endereco`).

---

## 🛠️ 2. Pacotes Concluídos (100% em Main)

### 📦 PACOTE 1 — Features do Cardápio Digital Público
- **Observações por Item**: Campo de recado no carrinho/modal, exibido com destaque rosa/âmbar no KDS (`CaixaPanel.tsx`) e impresso como `OBS: ...` no cupom térmico da cozinha.
- **Carrossel de Fotos por Produto**: Campo `imagens_galeria` (JSON) com até 3 fotos por produto no admin e no modal do produto (`CardapioProductModal.tsx`).

### 📦 PACOTE 2 — Multi-Tenant & KDS/Kanban
- **Remoção de Fallback Hardcoded**: Eliminado o fallback para `restaurante_id = 1`. A resolução de restaurante é 100% dinâmica por slug (`/c/:slug`) ou `?restaurante_id=X`.
- **Timer Visual de Atraso KDS (`KDSTimer`)**: Cronômetro em tempo real nos cards da Cozinha/KDS (`CaixaPanel.tsx`) com 3 faixas de cor (Verde `<10m`, Amarelo `10-15m`, Vermelho `>15m`).
- **Botão "Pedido Pronto"**: Dispara `PUT /comandas/itens/:itemId/status?status=pronto` com atualização otimista.

### 📦 PACOTE 3 — Logística de Entregas & PWA Motoboy (Fase 12b)
- **Token Temporário TTL 4h**: Endpoint `POST /comandas/motoboys/{id}/gerar-link` cria token JWT seguro com validade de 4 horas para o entregador.
- **Interface Móvel Ultra-Leve (`/entregador?token=xxx`)**: Componente standalone `MotoboyPwaPage.tsx` com visualização de entregas ativas, botões de ligação rápida, Waze/Google Maps, resumo de valores e botão **"Confirmar Entrega"** (executa `POST /comandas/motoboys/pedidos/{id}/confirmar-entrega`).
- **Despacho em 1 Clique via WhatsApp**: Botão **"💬 WhatsApp"** no Caixa (`CaixaPanel.tsx`) que abre `wa.me` preenchido com endereço, itens, valor a cobrar e o link do PWA do entregador.
- **QR Code por Mesa (`?mesa=X`) & Banner de Status em Tempo Real**: Suporte ao parâmetro `?mesa=X` no Cardápio Digital e banner com linha do tempo de 4 etapas (`Recebido` ➔ `Em Preparo` ➔ `Em Trânsito/Pronto` ➔ `Entregue`).

---

## 🧪 3. Estado dos Testes e Validação

- **Build Frontend (`npm run build`)**: 0 erros (bundle de produção em ~3.5s).
- **Suíte de Testes Pytest (`./.venv/bin/pytest`)**: **60/60 testes PASSARAM (100% OK)**.
  - Testes executados: `test_motoboy_pwa_flow.py`, `test_cardapio_digital.py`, `test_critical_pdv_caixa_flow.py`, `test_critical_cardapio_flow.py`, `test_critical_multitenant_rls.py`, `test_relatorios.py`, `test_caixa_reorganization.py`.

---

## 📌 4. Instruções de Execução

```bash
# Rodar build do frontend React
npm run build

# Rodar suíte completa de testes no backend
SECRET_KEY=dev_secret_key_for_testing_12345 ENCRYPTION_KEY=32_bytes_dev_encryption_key_123 ./.venv/bin/pytest backend/tests/test_motoboy_pwa_flow.py backend/tests/test_cardapio_digital.py backend/tests/test_critical_pdv_caixa_flow.py backend/tests/test_critical_cardapio_flow.py backend/tests/test_critical_multitenant_rls.py backend/tests/test_relatorios.py backend/tests/test_caixa_reorganization.py -v
```
