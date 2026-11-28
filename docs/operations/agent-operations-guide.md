# Guia Operacional Único para Agentes Autorizados (KÔM.A.I. / CLI / API)

> **Propósito:** permitir que o fundador + agentes autorizados (como KÔM.A.I. / ChatGPT / CLI) provisionem, configurem, diagnostiquem e desliguem restaurantes no KÔMA de forma determinística, idempotente e segura, sem depender do Super Admin nem reaprender todo o repositório.

---

## 1. Regras de Segurança Obrigatórias (Não Negociáveis)

1. **Tenant ID 6 é operação real protegida:** nunca criar pedidos sintéticos, reimpressões, alterações de configuração ou chamadas de escrita no ID 6. Use apenas tenants de laboratório QA autorizados ou ambientes locais temporários.
2. **Nunca imprimir nem commitar credenciais:** não exibir tokens (`KOMA_PROVISIONING_TOKEN`, `KOMA_SUPERADMIN_TOKEN`), senhas, cookies ou chaves em chat, logs, arquivos ou prompts. Passar tokens exclusivamente por variáveis de ambiente ou header `Authorization: Bearer <TOKEN>`.
3. **Nunca forjar contratos, pagamentos ou consentimentos:** `POST /api/contracts/self-accept` exige poderes do titular e aceitação real; nunca simular liquidação financeira sem gateway/webhook real.
4. **Proibido SQL manual para pular fluxos:** toda criação passa pelo motor universal (`universal_provisioning.py`) e toda exclusão/desligamento passa pelo motor oficial (`tenant_deprovisioning.py`).
5. **Política de Não Reutilização de IDs Históricos:** após desligar/purgar um tenant via `qa_purge`, o registro em `super_admin_audit_logs` é preservado de forma imutável e `inspect_tenant_id_eligibility` retorna `reusable: false`. Nunca force sequência de banco nem tente reaproveitar ID que já teve histórico/JWTs emitidos.

---

## 2. Caminhos e Modos de Autenticação Verificados

| Mecanismo | Uso principal | Variável / Header | Pré-requisito em produção |
|---|---|---|---|
| **Token Escopado de Provisionamento** | Provisionamento expresso (`Caminho B`), desligamento/verificação de tenant via CLI ou agente | `Authorization: Bearer $KOMA_PROVISIONING_TOKEN` + `X-Provisioning-Actor` | Variável `KOMA_PROVISIONING_API_TOKEN` configurada no serviço `Kôma` no Railway |
| **JWT do Administrador do Restaurante** | Onboarding (`/api/onboarding/*`), catálogo/lote (`/produtos/*`), vínculo contratual (`/api/contracts/self-accept`), impressão | `Authorization: Bearer <operator_jwt>` obtido em `POST /auth/login` ou retornado em `POST /api/provisioning/public/start` | Usuário `cargo="admin"`, `status="ativo"`, sem Modo Suporte |
| **JWT de Super Admin** | Fallback administrativo em `/api/super-admin/*` e `/api/provisioning/express` ou `.../deprovision` | `Authorization: Bearer $KOMA_SUPERADMIN_TOKEN` (via `POST /api/super-admin/token`) | Credenciais `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD_HASH` |
| **Público (sem login)** | Autoatendimento pelo próprio dono (`/comecar` -> `/api/provisioning/public/{preview,start}`) | Rate-limit por IP (`3/min`, `6/hora` em `/start`; `20/min` em `/preview`) | E-mail ainda não usado em nenhum tenant existente (`409` caso contrário) |

---

## 3. Ferramentas Oficiais Disponíveis

### 3.1 CLIs Locais Verificadas no Repositório
- **`scripts/koma-provision.mjs`** — CLI oficial para criar/pré-visualizar restaurantes no motor central (`POST /api/provisioning/express`).
- **`scripts/koma-deprovision.mjs`** — CLI oficial para dry-run, execução e verificação pós-exclusão/offboarding (`POST /api/provisioning/tenants/{id}/deprovision` e `GET .../verify`).
- **`scripts/support-preflight.mjs`** (`npm run ops:preflight`) — Preflight operacional, status Railway/Cloudflare e watch de deploy com smoke não destrutivo.
- **`scripts/production-smoke.mjs`** — Smoke somente GET/OPTIONS em produção (`https://app.komafood.com.br` + `https://sistema-gourmet-bistro-production.up.railway.app`).

> **Nota sobre MCPs/Plugins:** no ambiente atual do repositório, os conectores ativos para KÔMA são os endpoints HTTP da API, as CLIs Node acima e o terminal. Caso deseje expor ao OpenClaw/ChatGPT como MCP no futuro, use um wrapper fino (`< 150` linhas) apontando exclusivamente para `POST /api/provisioning/express` e `/tenants/{id}/deprovision` — sem duplicar regras de negócio.

---

## 4. Operações Principais (Comandos Exatos, Payloads e Idempotência)

### 4.1 Provisionamento Expresso com Dry-Run e Idempotência (`Caminho B`)

**Endpoint:** `POST /api/provisioning/express`  
**Permissão:** `KOMA_PROVISIONING_API_TOKEN` ou JWT Super Admin  
**Headers obrigatórios/recomendados:**
- `Authorization: Bearer <TOKEN>`
- `Content-Type: application/json`
- `Idempotency-Key: <chave-unica-estavel>` (ou `X-Idempotency-Key`)
- `X-Provisioning-Actor: <identificador-do-agente>`

**1) Executar `--dry-run` primeiro (zero efeitos colaterais):**
```bash
printf '%s\n' \
  'Nome: Pizzaria Exemplo' \
  'Segmento: Pizzaria' \
  'Responsável: Nome do Dono' \
  'Email: dono@exemplo.com.br' \
  'WhatsApp: 85999990000' \
  'Atendimento: Delivery, Retirada' \
  'Horário: 18h às 23h' \
  'Cardápio:' \
  'Pizzas Tradicionais:' \
  'Calabresa - R$ 49,90' \
| KOMA_PROVISIONING_TOKEN="<SEU_TOKEN>" \
  node scripts/koma-provision.mjs --stdin --dry-run --actor komai
```

**2) Executar criação real idempotente (apenas após revisar `missingFields` do dry-run):**
```bash
KOMA_PROVISIONING_TOKEN="<SEU_TOKEN>" \
  node scripts/koma-provision.mjs --input loja.txt --idempotency-key prov-loja-exemplo-v1 --actor komai
```
Para laboratório de QA interno autorizado: adicionar `--qa-lab` (abre janela temporária de QA isolada com auditoria e bloqueio automático de pagamento online real).

**Resposta esperada (`201 Created` em criação, `200 OK` em `dry_run=true` ou replay idempotente):**
```json
{
  "id": "12",
  "name": "Pizzaria Exemplo",
  "subdomain": "pizzaria-exemplo",
  "plan": "pro",
  "operationProfile": "pizzaria",
  "categoriesCreated": 5,
  "productsCreated": 1,
  "idempotentReplay": false
}
```
> Novas lojas nascem com `formas_pagamento_aceitas: ["Pix", "Dinheiro"]` para não bloquear o checkout público após concluir o onboarding.

---

### 4.2 Onboarding Autônomo Sem Super Admin (`Caminho A`)

1. **Pré-visualização sem gravação:** `POST /api/provisioning/public/preview` (`200 OK`) — valida texto estruturado (`structured_text` até 25 KB) ou campos guiados.
2. **Criação em Modo Preparação:** `POST /api/provisioning/public/start` (`201 Created`) — exige `admin_password` (>= 8 caracteres), recusa e-mail já usado em qualquer tenant (`409 Conflict`), aplica `applied_items <= 250`, retorna `access_token` de administrador (`cargo="admin"`), não inicia os 7 dias grátis (`pending_setup`).
3. **Retomada / Vínculo Contratual no Mesmo Tenant (`/contratar/:plan?vincular=1`):**
   - `GET /api/onboarding/status` (com `Bearer <admin_jwt>`) retorna `restaurant`, `operator` (`name`, `email`, `phone`), `steps` e `blockersNow`.
   - `POST /api/contracts/self-accept` (`201 Created`) vincula termo eletrônico + Pix pós-teste ao **mesmo restaurante já preparado**, sem criar tenant duplicado, respeitando `KOMA_SAAS_MANUAL_RELEASE_REQUIRED`.

---

### 4.3 Cardápio, Categorias, Complementos e Edição em Lote

Todas as rotas abaixo exigem `Authorization: Bearer <admin_jwt>` (do restaurante específico, obtido via `POST /auth/login` caso já criado):

| Ação | Método e Endpoint | Payload / Observações |
|---|---|---|
| Listar catálogo completo | `GET /produtos/catalogo` | Categorias + produtos do tenant |
| Criar categoria | `POST /produtos/categorias` | `{ "nome": "Pizzas", "ordem_exibicao": 1, "destino_impressao": "COZINHA" }` |
| Criar/editar produto | `POST /produtos/` · `PUT /produtos/{produto_id}` | Campos: `nome`, `preco`, `categoria_id`, `descricao`, `ativo`, `destaque`, `preco_promocional` |
| Importar itens em massa | `POST /produtos/importar` | Lista de produtos estruturada; suporta merge no catálogo |
| Publicar/pausar em lote | `PATCH /produtos/disponibilidade` | `{ "produto_ids": ["..."], "ativo": true }` |
| Edição em lote avançada | `PATCH /produtos/edicao-lote` | Reajuste `%`, `+/- R$`, `R$ fixo`, mover categoria, `destaque`, `somente_promocao`, adicionar/remover `GrupoModificador` |
| Duplicar produto | `POST /produtos/{produto_id}/duplicar` | `201 Created` em 1 chamada |
| Criar/editar complementos | `POST /cardapio/modificadores/grupos` · `PUT /cardapio/modificadores/grupos/{grupo_id}` | Suporta `tipo` (`adicional`, `escolha`, `meio_a_meio`), `min_opcoes`, `max_opcoes`, `opcoes[]` |
| Configurar atendimento/horários | `PUT /api/onboarding/operations` · `PATCH /api/cardapio-digital/config` | `tipos_pedido_ativos`, `delivery_ativo`, `formas_pagamento_aceitas`, `horarios_funcionamento`, `regra_preco_meio_a_meio` |

---

### 4.4 Desligamento e Exclusão Auditada de Tenant (`scripts/koma-deprovision.mjs`)

**Endpoints:**
- `POST /api/provisioning/tenants/{tenant_id}/deprovision`
- `GET /api/provisioning/tenants/{tenant_id}/deprovision/verify`

**Modos oficiais:**
- `qa_purge` (**somente ambientes fictícios / QA**): bloqueia automaticamente se `tenant_id` for `1` ou `6`, tiver grant `Founders` ativo (`saas_commercial_grants.active=true`), assinatura paga `active`, documentos fiscais (`fiscal_documents`) ou pagamentos online liquidados. Remove todo o grafo operacional em ordem topológica reversa e a linha em `restaurantes`, **preservando `super_admin_audit_logs`**.
- `client_offboarding` (**cancelamento de cliente real**): suspende `restaurantes.saas_status='suspended'`, revoga imediatamente JWTs via `user_session_versions` + WebSockets, desativa `print_agent_tokens`, remove `print_jobs` pendentes e assinaturas push, marca outbox pendente como `dead_letter`, cancela `saas_subscriptions`, e **preserva histórico legal/fiscal e pedidos**.

**Passo a passo seguro (obrigatório `dry-run` -> `execute` -> `verify`):**
```bash
# 1. Dry-run determinístico (gera expectedConfirmation e fingerprint)
KOMA_PROVISIONING_TOKEN="<SEU_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --mode qa_purge --dry-run --actor komai

# 2. Execução auditada usando o fingerprint e a confirmação exata do dry-run
KOMA_PROVISIONING_TOKEN="<SEU_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --mode qa_purge --execute \
  --fingerprint "<FINGERPRINT_DO_DRY_RUN>" \
  --confirm "DEPROVISION_TENANT_10" \
  --reason "Desligamento oficial do laboratório QA 10 após homologação" \
  --actor komai

# 3. Verificação pós-limpeza e política de ID
KOMA_PROVISIONING_TOKEN="<SEU_TOKEN>" \
  node scripts/koma-deprovision.mjs --tenant-id 10 --verify
```

**Comportamento idempotente:** repetir `--execute` em um tenant já purgado retorna `200 OK` com `alreadyDeprovisioned: true` e `deletedTotal: 0`.

---

## 5. Diagnóstico Operacional & Impressão

- **Impressão em tempo real (requer JWT Super Admin):** `GET /api/super-admin/restaurantes/{restaurant_id}/print-status` — mostra agentes conectados, principal, último heartbeat e fila de `print_jobs`.
- **Saúde pública do backend:** `GET /health/live` e `GET /health/ready` (`{"status":"ok","database":"healthy"}`).
- **Verificação pública não destrutiva de cardápio:** `GET /api/cardapio-digital/public?slug=<slug>` (retorna `404` quando tenant inexistente ou `aceitando_pedidos: false` / `403` no pedido quando em preparação ou suspenso).
- **Preflight de produção:** `npm run ops:preflight -- --smoke --backend`.

---

## 6. Tratamento de Erros e Procedimentos de Recuperação

| Código HTTP | Causa provável | Recuperação determinística |
|---|---|---|
| `401 Unauthorized` | Token ausente/expirado ou `KOMA_PROVISIONING_API_TOKEN` não configurado no Railway | Conferir existência da variável no Railway (sem imprimir segredo) ou renovar JWT via `/auth/login` |
| `403 Forbidden` | Loja em modo preparação tentando pedido comercial, ou operador sem cargo `admin`, ou tentativa de escrita em Modo Suporte | Concluir vínculo contratual / liberação ou autenticar como `admin` do próprio tenant |
| `404 Not Found` | Tenant/recurso inexistente ou já desprovisionado | Consultar `.../deprovision/verify` se estiver auditando desligamento |
| `409 Conflict` | E-mail já existente em outro tenant (`/public/start`), contrato já vinculado (`/self-accept`), fingerprint alterado no `deprovision`, ou trava de proteção (`Founders`/`Fiscal`/`Pago`/IDs `1,6`) | Usar outro e-mail ou reexecutar dry-run antes de `--execute`; em cliente real usar `mode=client_offboarding` |
| `422 Unprocessable` | Campo obrigatório ausente (`missingFields`), motivo `< 8` chars ou `--confirm` divergente | Corrigir entrada conforme `detail` sem inventar dados fictícios |
| `429 Too Many Requests` | Rate limit de `/api/provisioning/public/start` (`3/min`, `6/hora`) ou `/preview` (`20/min`) | Agentes internos devem usar `/api/provisioning/express` com token escopado, nunca a rota pública |

---

## 7. Limitações Conhecidas

1. **`KOMA_PROVISIONING_API_TOKEN` em produção:** precisa estar definido no serviço `Kôma` do Railway para que `koma-provision.mjs` e `koma-deprovision.mjs` operem sem sessão Super Admin.
2. **Assets externos no Supabase Storage:** `execute_deprovision` registra a lista completa de `storageAssets` no resultado e no `SuperAdminAuditLog`, porém não apaga objetos remotos do bucket quando não há credencial de storage autorizada na requisição (preservado para remoção auditável posterior sem risco de perda entre tenants).
3. **Homologação física de impressora Bluetooth:** comandos/APIs validam backend e fila, mas **nunca** substituem o teste real em aparelho Android + impressora pareada (`docs/operations/homologacao-fisica-bluetooth.md`).
