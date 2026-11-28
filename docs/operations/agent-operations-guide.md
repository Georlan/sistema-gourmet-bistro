# Guia Operacional Único para Agentes Autorizados (Komandinha / MCP / CLI / API)

> **Propósito:** permitir que o fundador + **Komandinha** (Chief of Staff via ChatGPT, MCP, conectores, APIs ou CLI) provisionem, configurem, diagnostiquem e desliguem restaurantes no KÔMA sem adivinhar parâmetros e sem ler todo o repositório.
> **Regra de escopo:** este documento **não contém credenciais** e **nunca autoriza** mutações em clientes reais protegidos.

---

## 1. Regras de Segurança Obrigatórias (Não Negociáveis)

1. **Tenant ID 6 é operação real protegida:** nunca criar pedidos sintéticos, reimpressões, alterações de configuração ou escrita no ID `6`. Use apenas tenants de laboratório QA autorizados ou ambientes locais temporários.
2. **Proibido imprimir, logar ou commitar credenciais:** tokens (`KOMA_AGENT_READ_TOKEN`, `KOMA_PROVISIONING_API_TOKEN`, `KOMA_OFFBOARDING_API_TOKEN`, `KOMA_DEPROVISIONING_API_TOKEN`, `KOMA_AGENT_TOKENS_JSON`, `KOMA_SUPERADMIN_TOKEN`), senhas, `SUPABASE_SERVICE_ROLE_KEY` e JWTs de operadores nunca devem aparecer em chats, arquivos, logs ou commits.
3. **Separação de privilégios (`Least Privilege`):**
   - Token de leitura (`agent:read`) **só** consulta e executa `dry-run` / `verify`.
   - Token de provisionamento (`agent:provision`) cria restaurantes e faz `dry-run`, **mas recebe `403 Forbidden` ao tentar desligar ou purgar qualquer tenant**.
   - Token de offboarding (`agent:deprovision_offboard`) executa apenas `client_offboarding` (suspende acesso e preserva histórico legal/pedidos/fiscais), recebendo `403 Forbidden` em `qa_purge`.
   - Token de limpeza QA (`agent:deprovision_qa_purge`) pode executar `qa_purge` em tenants de QA elegíveis (IDs `1, 6`, `Founders`, `active` subscriptions, `fiscal_documents` e pagamentos liquidados são bloqueados no servidor com `409 Conflict`).
4. **Identidade confiável do agente:** o header `X-Provisioning-Actor` é armazenado **apenas** como metadado declarativo suplementar (`declared_actor`). A identidade autoritativa gravada na auditoria (`SuperAdminAuditLog.actor`) é sempre derivada do slot autenticado + fingerprint SHA-256 do token (`agent:<slot_id>:fp:<8hex>` ou `superadmin:<user>`).
5. **WhatsApp nunca é pré-requisito para comprar pelo KÔMA** (`KOMA_WHATSAPP_AUTOMATION_ENABLED` é opcional e o checkout público funciona com `Dinheiro` sem setup prévio e `Pix` após conexão real).
6. **Política de Não Reutilização de IDs Históricos:** após `qa_purge`, `super_admin_audit_logs` permanece imutável e `inspect_tenant_id_eligibility` retorna `reusable: false`. Nunca force sequence SQL.
7. **Saída física de impressão:** APIs e MCP comprovam fila (`PrintJob`) e heartbeat (`PrintAgentToken`), **nunca** saída física no papel térmico (exige teste presencial com `docs/operations/homologacao-fisica-bluetooth.md`).

---

## 2. Mapa de Autenticação, Escopos, Rotação e Revogação

### 2.1 Variáveis de Ambiente no Railway (`passionate-truth` / `Kôma`)

| Variável | Escopos concedidos | Operações liberadas | Operações bloqueadas (`403`) |
|---|---|---|---|
| `KOMA_AGENT_READ_TOKEN` | `agent:read` | `GET /api/provisioning/tenants`, `.../readiness`, `.../deprovision/verify`, `POST .../express` (`dry_run=true`), `POST .../deprovision` (`dry_run=true`) | Qualquer criação ou desligamento real |
| `KOMA_PROVISIONING_API_TOKEN` | `agent:read`, `agent:provision` | Leitura + criação `POST /api/provisioning/express` | `POST .../deprovision` com `dry_run=false` (`qa_purge` e `client_offboarding`) |
| `KOMA_OFFBOARDING_API_TOKEN` | `agent:read`, `agent:deprovision_offboard` | Leitura + `mode="client_offboarding"` | Criação via `/express` e `mode="qa_purge"` |
| `KOMA_DEPROVISIONING_API_TOKEN` | `agent:read`, `agent:deprovision_offboard`, `agent:deprovision_qa_purge` | Leitura + offboarding + `qa_purge` em tenants elegíveis | Criação via `/express` (se não combinado com `agent:provision`) |
| `KOMA_AGENT_TOKENS_JSON` | Escopos explícitos por agente | JSON array `[{"id":"komandinha-ops","token":"...","scopes":["agent:read","agent:provision"],"revoked":false}]` | Qualquer item ausente de `scopes` ou com `"revoked": true` (rejeitado com `401`) |
| **JWT Admin do Restaurante** | Dono do tenant (`cargo="admin"`) | `/api/onboarding/*`, `/produtos/*`, `/cardapio/modificadores/*`, `/produto-familias/*`, `/api/cardapio-digital/config`, `/caixa/configuracoes`, `/api/contracts/self-accept` | Rotas `/api/super-admin/*`, `/api/provisioning/express`, `.../deprovision`, e dados de outros tenants |
| **JWT Super Admin** | Fallback administrativo completo | Todos os escopos acima | Modo Suporte (somente leitura) bloqueia mutações |

### 2.2 Rotação e Revogação sem Downtime

1. **Rotação via variáveis simples (vírgula):** defina `VAR="TOKEN_NOVO,TOKEN_ANTIGO"`, verifique os clientes com `TOKEN_NOVO`, depois remova `TOKEN_ANTIGO` deixando apenas `VAR="TOKEN_NOVO"`. Não exige alteração de código.
2. **Revogação granular por agente (`KOMA_AGENT_TOKENS_JSON`):** altere `"revoked": true` no registro do agente comprometido ou remova seu objeto da lista no Railway. O backend lê o ambiente dinamicamente por requisição, então a revogação passa a valer imediatamente após o restart/redeploy do container.

---

## 3. Ferramentas MCP ao Vivo para a Komandinha (ChatGPT OAuth 2.1)

O backend de produção já expõe o servidor MCP stateless oficial em:
- **Endpoint MCP:** `https://sistema-gourmet-bistro-production.up.railway.app/mcp`
- **Metadata OAuth Protected Resource:** `https://sistema-gourmet-bistro-production.up.railway.app/.well-known/oauth-protected-resource/mcp`
- **Issuer OAuth 2.1 (Worker Cloudflare):** `https://koma-mcp-oauth-staging.georlanjunior.workers.dev`
- **Escopo suportado:** `mcp:ops:read` (`KOMA_MCP_ENABLED=true`, validando `iss`, `aud`, `client_id` e `sub` do operador autorizado).
- **Segurança:** todas as ferramentas abaixo rodam em transação PostgreSQL `SET LOCAL TRANSACTION READ ONLY` com `statement_timeout`, limite de concorrência em pool e **zero PII** (sem e-mails, telefones, endereços ou tokens). Operações de escrita/criação/exclusão **não** são expostas no MCP; executam exclusivamente via API HTTP autenticada / CLIs com tokens escopados.

| Ferramenta MCP | Parâmetros | Retorno e uso recomendado para a Komandinha |
|---|---|---|
| `ops_get_product_contract` | *(nenhum)* | Versão, planos, preços oficiais (`Pocket R$ 99,90`, `Pro R$ 179,90`, `Premium R$ 329,90`, 0% comissão), `founders_program` (`R$ 79,90`), módulos futuros e regras de onboarding. |
| `ops_get_system_health` | *(nenhum)* | Saúde em memória (`db_pool`, `realtime_websocket`, `outbox_worker`) com `0` queries no banco. |
| `ops_get_checkout_outcomes` | `window_minutes` (`15` \| `60` \| `1440`) | Volume agregado de pedidos persistidos e status de pagamento online na janela. |
| `ops_get_print_flow_summary` | *(nenhum)* | Fila agregada de `print_jobs` (`pending`/`claimed`/`printing`/`delayed`/`failed`) e agentes online nos últimos 90s (`physical_output_verified: false`). |
| `ops_list_restaurants` | `limit` (`1..100`, padrão `50`), `include_suspended` (`bool`) | Inventário operacional por tenant (ID, nome, slug, plano, `saasStatus`, `operationProfile`, `trialStatus`, contagens de categorias/produtos/agentes, `mercadoPagoConnected`). |
| `ops_get_restaurant_readiness` | `tenant_id` (`int > 0`) | Diagnóstico completo de prontidão de implantação: os 4 passos essenciais (`profile`, `hours`, `catalog`, `operations`), catálogo (incluindo grupos `meio_a_meio` e famílias), delivery, meios de pagamento e fila de impressão da loja. |
| `ops_preview_restaurant_provisioning` | `structured_text?`, `name?`, `subdomain?`, `plan="pro"`, `operation_profile?`, `segment_preset?`, `menu_text?` | Executa parser determinístico + checagem de slug disponível em READ ONLY **sem gravar** e sem expor PII (`readyToProvision`, `missingFields`, `warnings`, `bootstrap`). |
| `ops_verify_tenant_deprovision` | `tenant_id` (`int > 0`) | Audita tabelas operacionais residuais, assets de storage residuais, último `TENANT_STORAGE_CLEANUP`, logs preservados e `idReusePolicy`. |

---

## 4. Contratos HTTP Completos (API + CLIs)

**Base URL Produção:** `https://sistema-gourmet-bistro-production.up.railway.app`

### 4.1 Consulta e Diagnóstico (`agent:read` ou Super Admin JWT)

#### `GET /api/provisioning/tenants?limit=50&include_suspended=true`
Retorna `{ "observed_at": "...", "total": N, "restaurants": [...], "coverage": { "pii_included": false } }`.

#### `GET /api/provisioning/tenants/{tenant_id}/readiness`
Retorna estado completo do tenant (ou `{ "exists": false, "tenantId": ... }`) sem PII:
```json
{
  "exists": true,
  "tenantId": "12",
  "name": "Pizzaria Forno 27",
  "slug": "pizzaria-forno-27",
  "plan": "pro",
  "saasStatus": "active",
  "operationProfile": "pizzaria",
  "trial": { "status": "pending_setup", "startedAt": null, "endsAt": null, "daysGranted": 7 },
  "steps": { "profile": true, "hours": true, "catalog": true, "operations": true },
  "missingEssentialSteps": [],
  "configurationComplete": true,
  "catalog": {
    "categoriesCount": 5,
    "productsTotal": 14,
    "activeProductsCount": 14,
    "modifierGroupsCount": 3,
    "meioAMeioGroupsCount": 1,
    "familiesCount": 1
  },
  "operations": {
    "orderTypes": ["retirada", "delivery"],
    "deliveryEnabled": true,
    "deliveryFeeMode": "fixa",
    "deliveryFixedFee": 7.0,
    "acceptedPaymentMethods": ["Dinheiro"],
    "mercadoPagoConnected": false
  },
  "printing": {
    "activeAgentsTotal": 0,
    "onlineWithin90s": 0,
    "hasPrimaryAgent": false,
    "pendingJobs": 0,
    "failedJobsLast60m": 0
  },
  "publicMenuPath": "/c/pizzaria-forno-27"
}
```

---

### 4.2 Provisionamento de Restaurante (`Caminho B` — `POST /api/provisioning/express`)

- **Autenticação & Escopo:**
  - `dry_run: true` → requer `agent:read` (`KOMA_AGENT_READ_TOKEN` ou `KOMA_PROVISIONING_API_TOKEN` ou Super Admin JWT).
  - `dry_run: false` → requer `agent:provision` (`KOMA_PROVISIONING_API_TOKEN` ou Super Admin JWT).
- **Headers recomendados:**
  - `Authorization: Bearer <TOKEN>`
  - `Content-Type: application/json`
  - `Idempotency-Key: <chave-estavel-ex-prov-forno27-v1>` (também aceita `X-Idempotency-Key`)
  - `X-Provisioning-Actor: komandinha` *(opcional, apenas metadado declarativo)*
- **Payload completo (`ExpressProvisioningRequest`, `extra="forbid"`):**
  - **Modo estruturado em texto:** `structured_text` (`string | null`, máx `25.000` chars). Pode ser combinado com campos JSON explícitos (o JSON explícito tem precedência).
  - **Campos de loja:**
    - `name` (`string | null`, máx `255` — **obrigatório** se não vier em `structured_text`)
    - `subdomain` (`string | null`, máx `100` — slug opcional; se omitido, gera slug único a partir de `name`)
    - `plan` (`"pocket"` | `"pro"` | `"premium"`, padrão `"pro"`)
    - `operation_profile` (`"generic"` | `"pizzaria"` | `"acai"` | `"churrasco"` | `"marmitaria"` | `null`)
    - `segment_preset` (`"hamburgueria"` | `"pizzaria"` | `"marmitaria"` | `"cafeteria"` | `"acaiteria"` | `"churrascaria"` | `null`)
    - `apply_segment_preset` (`bool`, padrão `true`) — cria categorias iniciais com destino `COZINHA`/`NENHUM`
  - **Campos do titular / contato:**
    - `admin_name` (`string | null`, máx `100` — **obrigatório** na criação real)
    - `admin_email` (`string | null`, máx `100` — **obrigatório** na criação real)
    - `admin_password` (`string | null`, `8..72` bytes — opcional no `/express`; se omitida, gera `activation.mode="invite_pending"` + token único de convite; se informada, ativa usuário imediatamente)
    - `phone` (`string | null`, máx `30`)
    - `address` (`string | null`, máx `255`)
  - **Operação & catálogo inicial:**
    - `order_types` (`list["consumo_local" | "retirada" | "delivery"]`, opcional)
    - `operating_hours` (`list[{ "days": str, "hours": str }]`, opcional)
    - `menu_text` (`string | null`, máx `25.000` chars — linhas `Categoria:` + `Item - R$ 49,90`)
    - `menu_items` (`list[{ "name": str, "price": float >= 0, "category": str = "Cardápio", "description": str = "" }]`)
  - **Controle de execução:**
    - `dry_run` (`bool`, padrão `false`) — sempre rodar `true` primeiro!
    - `defer_trial` (`bool`, padrão `true`) — nasce em Modo Preparação sem gastar dias do trial.
    - `qa_lab` (`bool`, padrão `false`) — abre janela QA temporária somente para testes internos autorizados.
    - `qa_hours` (`int`, `1..72`, padrão `24`)
    - `restaurant_id` (`int | null`) — sugestão de ID elegível (`no_reuse_when_historical_audit_present` impede forçar ID histórico).
    - `idempotency_key` (`string | null`, máx `120`)

> **Meios de pagamento padrão na criação:** novos restaurantes nascem com `formas_pagamento_aceitas: ["Dinheiro"]` (modalidade imediatamente recebível no balcão/entrega sem setup prévio). `"Pix"` é habilitado automaticamente ao conectar Mercado Pago OAuth ou ao configurar chave Pix em `Cardápio online -> Pagamentos` (Pix Direto).

**Exemplo CLI com `--dry-run` e execução:**
```bash
KOMA_AGENT_READ_TOKEN="<TOKEN_LEITURA>" \
  node scripts/koma-provision.mjs --input loja.json --dry-run

KOMA_PROVISIONING_API_TOKEN="<TOKEN_PROVISION>" \
  node scripts/koma-provision.mjs --input loja.json --idempotency-key prov-loja-v1 --actor komandinha
```

---

### 4.3 Login do Administrador da Loja & Vínculo Contratual

Após criar a loja via `/express`:
- Se criou **com `admin_password`**, autentique o dono/operador com:
  - `POST /auth/login` (`Content-Type: application/json`, `{ "username": "<admin_email>", "password": "..." }` — ou `{ "restaurante_id": 12, "username": "<admin_email>", "password": "..." }` quando o mesmo e-mail administra múltiplas lojas e recebe `409 restaurant_selection_required`).
  - Retorno: `{ "access_token": "<admin_jwt>", "token_type": "bearer", "user": {...} }`.
- Se criou **sem `admin_password`** (`activation.mode === "invite_pending"`), o titular define a senha pela URL `/ativar-conta?token=<activation.token>` (ou `POST /api/contracts/invite/accept`), ou faz login após ativação.
- Para cadastrar uma **2ª loja do mesmo dono pela rota pública** (`POST /api/provisioning/public/start`), envie `Authorization: Bearer <owner_jwt>` provando titularidade do mesmo `admin_email`; chamadas anônimas com e-mail existente continuam bloqueadas (`409 Conflict`).
- **Ativação comercial autônoma (`KOMA_SAAS_MANUAL_RELEASE_REQUIRED=false` em produção):**
  - Após concluir os 4 itens essenciais (`profile`, `hours`, `catalog`, `operations`), o cliente aceita os termos em `/contratar/:plan?vincular=1` → `POST /api/contracts/self-accept`.
  - O backend vincula ao **mesmo tenant**, preserva cardápio/configurações e **inicia automaticamente os 7 dias grátis** (`status: "ready"`, `autoReleased: true`, `trialStarted: true`), mantendo as condições `Founders` intactas quando houver grant (`cohort_code="founders_5"`, R\$ 79,90/mês) e permitindo suspensão administrativa excepcional em `PUT /api/super-admin/restaurantes/{id}/status`.

---

### 4.4 Operações no Cardápio e Configurações da Loja (`Authorization: Bearer <admin_jwt>`)

#### A) Categorias (`POST /produtos/categorias` | `PUT /produtos/categorias/{id}` | `PUT /produtos/categorias/reordenar`)
- **`POST /produtos/categorias` (`201 Created`)**
  - Obrigatórios: `id` (`string`, ex.: `"cat-pizzas-tradicionais"`), `nome` (`string`)
  - Opcionais: `destino_impressao` (`"COZINHA"` \| `"BAR"` \| `"NENHUM"`, padrão `"COZINHA"`), `ordem_exibicao` (`int | null`)
- **`PUT /produtos/categorias/reordenar` (`200 OK`)**
  - Body: `{ "categoria_ids": ["cat-pizzas-grandes", "cat-pizzas-medias", "cat-bebidas"] }` ou `{ "ordens": [{ "id": "...", "ordem_exibicao": 10 }] }`.

#### B) Produtos individuais (`POST /produtos/` | `PUT /produtos/{produto_id}` | `POST /produtos/{produto_id}/duplicar`)
- **`POST /produtos/` (`201 Created`)** (`ProdutoCreate`):
  - Obrigatórios: `id` (`string`), `nome` (`string`), `preco` (`float >= 0`), `categoria_id` (`string`)
  - Opcionais: `cardapio_id`, `descricao` (`""`), `imagem`, `imagens_galeria`, `ativo` (`true`), `destaque` (`false`), `somente_promocao` (`false`), `selo`, `preco_promocional` (`< preco`), `ordem_exibicao` (`int`).

#### C) Importação em massa (`POST /produtos/importar`)
- Aceita lista `[ProdutoImportItem]` **ou** `CardapioImportPayload` (`categories`/`categorias`, `products`/`produtos`):
  - **ATENÇÃO ao `mode`:**
    - `"replace"` (**padrão!**): **inativa (`ativo = false`) todos os produtos existentes da loja que NÃO estiverem na lista importada** — ótimo na carga inicial completa, **perigoso** se quiser apenas acrescentar itens!
    - `"merge"`: adiciona novos itens e atualiza os IDs enviados **sem desativar** o catálogo anterior. **Sempre prefira `"mode": "merge"` em incrementos!**
  - Limite: `1..2000` itens por chamada, IDs únicos no payload.
```json
{
  "mode": "merge",
  "categories": [
    { "id": "cat-pizzas", "nome": "Pizzas", "destino_impressao": "COZINHA" },
    { "id": "cat-bebidas", "nome": "Bebidas", "destino_impressao": "NENHUM" }
  ],
  "products": [
    {
      "id": "pizza-grande",
      "nome": "Pizza Grande (8 fatias)",
      "preco": 0.0,
      "categoria_id": "cat-pizzas",
      "descricao": "Escolha até 2 sabores",
      "ativo": true
    },
    {
      "id": "coca-2l",
      "nome": "Coca-Cola 2L",
      "preco": 14.0,
      "categoria_id": "cat-bebidas",
      "ativo": true
    }
  ]
}
```

#### D) Edição em lote (`PATCH /produtos/edicao-lote`) e Disponibilidade (`PATCH /produtos/disponibilidade`)
- **`PATCH /produtos/disponibilidade`**: `{ "produto_ids": ["id1", "id2"], "ativo": true }`
- **`PATCH /produtos/edicao-lote`** (`EdicaoLoteRequest`, `1..500` `produto_ids`):
  - Campos opcionais: `reajuste_percentual` (`-90..500`), `reajuste_valor` (`-10000..10000`), `preco_fixo` (`0..100000`), `categoria_id`, `destaque` (`bool`), `somente_promocao` (`bool`), `adicionar_grupos_modificadores_ids` (`list[str]`, máx 50), `remover_grupos_modificadores_ids` (`list[str]`, máx 50).

#### E) Famílias de Produtos / Variações (`POST /produto-familias` | `PUT /produto-familias/{family_id}` | `PUT /produto-familias/{family_id}/personalizacoes`)
- Cria/agrupa SKUs reais (`Produto`) sob uma mesma exibição no cardápio (ex.: tamanhos `P / M / G` ou versões de bebida), **com escolhas/adicionais compartilhados sem duplicar cadastro**.
- Campos obrigatórios em `FamilyWrite` (`extra="forbid"`):
  - `nome` (`1..160`), `categoria_id`, `variantes` (`1..100` itens `{ "rotulo": "Grande", "preco": 58.0, "ativo": true, "produto_id": null }`).
- Opcionais: `descricao`, `eixo` (`"tamanho"` | `"sabor"` | `"outra"`, padrão `"tamanho"`), `cardapio_id`, `imagem`, `grupo_ids` (atalho atômico para vincular grupos compartilhados), `grupos_anteriores` (controle otimista de concorrência em edição).

#### F) Grupos de Modificadores, Sabores e Meio a Meio (`POST /cardapio/modificadores/grupos` | `PUT /cardapio/modificadores/grupos/{grupo_id}`)
- Campos principais (`GrupoModificadorCreateV2`):
  - `nome` (`1..100`, obrigatório)
  - `tipo`: `"obrigatorio"` | `"opcional"` | `"meio_a_meio"`
  - `min_selecoes` (`int >= 0`), `max_selecoes` (`int >= 1`)
  - `regra_preco_meio_a_meio` (válido quando `tipo == "meio_a_meio"`): `"maior_preco"` (cobra o sabor de maior valor) | `"media"` (média dos sabores escolhidos) | `"soma"` (soma dos adicionais). *Nos demais tipos, o servidor fixa `"maior_preco"`.*
  - `opcoes`: lista de `{ "nome": str, "preco_adicional": float >= 0, "ativo": bool = true }`
  - `produto_ids`: lista de IDs de `Produto` onde o grupo se aplica diretamente
  - `categoria_ids`: lista de IDs de `Categoria` (vínculo em lote; `incluir_subcategorias: bool = true`)
  - **Atualização (`PUT`):** envie `opcoes_originais` para proteção de concorrência caso opções já tenham sido carregadas.

#### G) Perfil, Horários, Formas de Pagamento, Modalidades e Delivery
1. **`PUT /api/onboarding/operation-profile`**: `{ "operation_profile": "pizzaria" }` (valores: `"generic"`, `"pizzaria"`, `"acai"`, `"churrasco"`, `"marmitaria"`).
2. **`PUT /api/onboarding/operations`**: `{ "order_types": ["consumo_local", "retirada", "delivery"] }` (pelo menos 1).
3. **`PUT /api/cardapio-digital/config`** (`RestauranteConfigUpdate`, campos todos opcionais):
   - `nome`, `slug`, `subtitulo`, `sobre_nos`, `endereco`, `google_maps_url`, `latitude`, `longitude`, `status_override` (`"Automático"` | `"Aberto"` | `"Fechado"`), `cor_primaria`, `cor_fundo`
   - `socials`: `{ "whatsapp": "85999990000", "instagram": "@forno27" }`
   - `horarios_funcionamento`: `[{ "days": "Terça a Domingo", "hours": "18:00 - 23:30" }]`
   - `formas_pagamento_aceitas`: `["Dinheiro", "Cartão de crédito", "Cartão de débito"]` *(só adicione `"Pix"` após configurar Mercado Pago OAuth ou Pix Direto)*
4. **`PUT /caixa/configuracoes`** (`ConfiguracaoRestauranteUpdate`):
   - `delivery_ativo` (`bool`)
   - `tipo_taxa_entrega`: `"fixa"` | `"bairro"` | `"distancia"`
   - `taxa_entrega_fixa` (`float >= 0`, quando `"fixa"`)
   - `pedido_minimo` (`float >= 0`), `pedido_minimo_retirada` (`bool`), `frete_gratis_valor` (`float >= 0`)
   - `tabela_taxas_bairros` (`list`, quando `"bairro"`), `tabela_taxas_km` (`list`, quando `"distancia"`)
   - **Origem de distância (`PUT /caixa/configuracoes/delivery-origin`):** `{ "latitude": -5.145, "longitude": -38.096 }`

---

## 5. Blueprint Completo: Configurar Cardápio Complexo de Pizzaria (Passo a Passo)

No KÔMA, uma pizzaria completa com **múltiplos tamanhos**, **sabores com preços por tamanho**, **meio a meio (até 2 ou 3 sabores)**, **bordas recheadas** e **adicionais pagos** é montada sem hacks usando **Produtos por Tamanho** + **Grupos de Sabores (`meio_a_meio`) específicos por tamanho** + **Grupos de Borda/Adicionais**:

> **Por quê?** Como o preço de um sabor costuma mudar conforme o tamanho (ex.: *Frango com Catupiry* custa R\$ 38 na Broto, R\$ 52 na Média, R\$ 64 na Grande), **cada tamanho é um `Produto` real** (`pizza-media`, `pizza-grande`, ou variantes via `/produto-familias`), ligado ao **seu próprio grupo `meio_a_meio`** com o preço daquele tamanho em cada sabor! Assim o cálculo `maior_preco` / `media` funciona exatamente como esperado tanto no Cardápio Público quanto no Caixa/PDV e na impressão.

### Sequência exata de chamadas (após provisionar com `operation_profile: "pizzaria"`):

**Passo 1 — Autenticar como admin da loja** → obter `admin_jwt` em `POST /auth/login`.

**Passo 2 — Garantir categorias (`POST /produtos/importar` com `mode: "merge"`):**
Importe os produtos-tamanho (`preco: 0.0` quando o valor vem 100% do sabor escolhido no grupo `meio_a_meio`, **ou** preço base + adicional dos sabores especiais) e as bebidas/sobremesas:
```json
{
  "mode": "merge",
  "categories": [
    { "id": "cat-pizzas", "nome": "Pizzas", "destino_impressao": "COZINHA" },
    { "id": "cat-bebidas", "nome": "Bebidas", "destino_impressao": "NENHUM" }
  ],
  "products": [
    {
      "id": "pizza-media-6",
      "nome": "Pizza Média (6 fatias)",
      "preco": 0.0,
      "categoria_id": "cat-pizzas",
      "descricao": "Até 2 sabores — prevalece o sabor de maior valor",
      "ativo": true
    },
    {
      "id": "pizza-grande-8",
      "nome": "Pizza Grande (8 fatias)",
      "preco": 0.0,
      "categoria_id": "cat-pizzas",
      "descricao": "Até 2 sabores — prevalece o sabor de maior valor",
      "ativo": true
    },
    {
      "id": "pizza-familia-12",
      "nome": "Pizza Família (12 fatias)",
      "preco": 0.0,
      "categoria_id": "cat-pizzas",
      "descricao": "Até 3 sabores — prevalece o sabor de maior valor",
      "ativo": true
    },
    {
      "id": "guarana-2l",
      "nome": "Guaraná Antarctica 2L",
      "preco": 13.0,
      "categoria_id": "cat-bebidas",
      "ativo": true
    }
  ]
}
```
*(Alternativa visual agrupada: em vez de criar os 3 tamanhos soltos em `importar`, você pode criá-los via `POST /produto-familias` com `eixo: "tamanho"`, mantendo 1 SKU por tamanho, caso deseje que os tamanhos compartilhem exatamente os mesmos adicionais sem variar por tamanho. Para preços de sabores distintos por tamanho, mantenha um grupo `meio_a_meio` para cada `produto_id` de tamanho.)*

**Passo 3 — Criar grupo de sabores `meio_a_meio` da Pizza Média (`POST /cardapio/modificadores/grupos`):**
```json
{
  "nome": "Sabores — Pizza Média (até 2)",
  "tipo": "meio_a_meio",
  "regra_preco_meio_a_meio": "maior_preco",
  "min_selecoes": 1,
  "max_selecoes": 2,
  "produto_ids": ["pizza-media-6"],
  "opcoes": [
    { "nome": "Calabresa", "preco_adicional": 44.0, "ativo": true },
    { "nome": "Marguerita", "preco_adicional": 42.0, "ativo": true },
    { "nome": "Frango com Catupiry", "preco_adicional": 48.0, "ativo": true },
    { "nome": "Camarão com Cream Cheese", "preco_adicional": 58.0, "ativo": true }
  ]
}
```
**Passo 4 — Criar grupo de sabores `meio_a_meio` da Pizza Grande (`POST /cardapio/modificadores/grupos`):**
Mesmo formato, apontando `"produto_ids": ["pizza-grande-8"]`, `"min_selecoes": 1`, `"max_selecoes": 2` (ou `3` na Família) e com a tabela de preços da Grande/Família.

**Passo 5 — Criar Borda Recheada e Adicionais Pagos aplicados à categoria inteira (`POST /cardapio/modificadores/grupos`):**
```json
{
  "nome": "Borda Recheada",
  "tipo": "opcional",
  "min_selecoes": 0,
  "max_selecoes": 1,
  "categoria_ids": ["cat-pizzas"],
  "incluir_subcategorias": true,
  "opcoes": [
    { "nome": "Catupiry Original", "preco_adicional": 10.0, "ativo": true },
    { "nome": "Cheddar", "preco_adicional": 9.0, "ativo": true },
    { "nome": "Chocolate ao Leite", "preco_adicional": 12.0, "ativo": true }
  ]
}
```
E outro grupo `"Adicionais na Pizza"` com `"tipo": "opcional"`, `"min_selecoes": 0`, `"max_selecoes": 5`, `"categoria_ids": ["cat-pizzas"]`.

**Passo 6 — Configurar horários, pagamento na entrega/presencial, modalidades e taxa de entrega:**
1. `PUT /api/onboarding/operations` → `{ "order_types": ["consumo_local", "retirada", "delivery"] }`
2. `PUT /api/cardapio-digital/config` → `horarios_funcionamento`, `endereco`, `socials: {"whatsapp": "..."}`, `formas_pagamento_aceitas: ["Dinheiro", "Cartão de crédito", "Cartão de débito"]` *(sem `"Pix"` até configurar Mercado Pago ou Pix Direto)*.
3. `PUT /caixa/configuracoes` → `{ "delivery_ativo": true, "tipo_taxa_entrega": "fixa", "taxa_entrega_fixa": 8.0, "pedido_minimo": 35.0 }`.

**Passo 7 — Verificar prontidão (via MCP `ops_get_restaurant_readiness` ou `GET /api/provisioning/tenants/{id}/readiness`):**
Confirmar `configurationComplete: true`, `meioAMeioGroupsCount >= 2` e `orderTypes` corretos antes de compartilhar `/c/<slug>` ou seguir para o aceite contratual `/contratar/:plan?vincular=1`.

---

## 6. Desligamento e Limpeza Auditável de Tenants (`scripts/koma-deprovision.mjs`)

- **`mode="qa_purge"`** (requer `agent:deprovision_qa_purge`, **exclusivo QA/homologação**):
  - Bloqueado com `409 Conflict` se `tenant_id in {1, 6}`, houver grant ativo (`saas_commercial_grants.active=true`), assinatura `active`, `fiscal_documents` ou pagamento online liquidado.
  - Purga todas as tabelas operacionais em ordem topológica reversa, revoga sessões/WebSockets, preserva `super_admin_audit_logs`, coleta e apaga individualmente apenas objetos do Supabase Storage cuja propriedade `<tenant_id>/(products|logo|banner)/<arquivo>` seja inequívoca e sem referência em outros tenants (`TENANT_STORAGE_CLEANUP`), e marca `reusable: false` na política de IDs.
- **`mode="client_offboarding"`** (requer `agent:deprovision_offboard`, **clientes reais encerrados**):
  - Suspende acesso (`saas_status='suspended'`), revoga JWTs/WebSockets, desativa `print_agent_tokens`, limpa jobs/push pendentes, move outbox para `dead_letter`, cancela assinaturas, **preserva pedidos, histórico financeiro, documentos fiscais e objetos de Storage** (`retainedForOffboarding`).

**Sequência obrigatória (`dry-run` → `--execute` → `--verify`) e retomada de falha parcial no Storage:**
```bash
# 1. Dry-run (escopo agent:read)
KOMA_AGENT_READ_TOKEN="<READ_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --mode qa_purge --dry-run

# 2. Execução com fingerprint e confirmação literais do dry-run
KOMA_DEPROVISIONING_API_TOKEN="<DEPROV_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --mode qa_purge --execute \
  --fingerprint "<FINGERPRINT>" --confirm "DEPROVISION_TENANT_10" \
  --reason "Limpeza oficial do tenant QA 10 apos homologacao"

# 3. Se storageCleanup.retryablePaths retornar não vazio (ex.: falha transitória de rede):
KOMA_DEPROVISIONING_API_TOKEN="<DEPROV_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --mode qa_purge --execute \
  --confirm "DEPROVISION_TENANT_10" --reason "Retomada de limpeza de storage QA 10" \
  --retry-storage "10/logo/arquivo.webp"

# 4. Auditoria final de resíduos + política de não reutilização de ID
KOMA_AGENT_READ_TOKEN="<READ_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --verify
```

---

## 7. Tratamento de Erros e Recuperação Rápida

| HTTP | Significado | Ação de recuperação |
|---|---|---|
| `401 Unauthorized` | Token ausente/expirado/revogado ou não configurado no Railway | Conferir existência das env vars `KOMA_*_TOKEN` no serviço `Kôma` (ou renovar JWT via `/auth/login`). |
| `403 Forbidden` | Token válido sem o escopo necessário (`agent:read` tentando criar, `agent:provision` tentando purgar, loja em preparação tentando pedido comercial, Modo Suporte tentando escrever) | Usar o token com o escopo correto ou concluir vínculo contratual (`/contratar/:plan?vincular=1`). |
| `409 Conflict` | E-mail já existente no `/public/start` anônimo, fingerprint alterado, trava `Founders`/`Fiscal`/`Pago`/IDs `1,6`, contrato já vinculado, `opcoes_originais` desatualizado | Autenticar dono para 2ª loja, refazer `--dry-run`, ou usar `client_offboarding`. |
| `422 Unprocessable` | Campo obrigatório ausente, `extra="forbid"` violado, `reason < 8` chars, confirmação literal divergente | Corrigir exatamente conforme `detail` retornado pela API. |
| `429 Too Many Requests` | Rate limit público em `/api/provisioning/public/{preview,start}` (`20/min` preview; `3/min` e `6/hora` start) | Agentes internos devem usar `/api/provisioning/express` + token escopado, nunca `/public/start`. |
