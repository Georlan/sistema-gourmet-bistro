# KÔMA — Arquitetura pós-Scale Up, Diagnóstico CTO, FinOps e Android (`v1.2.0`)

> Consolidação institucional dos diagnósticos técnicos das Waves 1–6, Encerramento Scale Up e Checkpoint Final de Prontidão (`28/11/2026`). Critério estrito: separa **Problema confirmado**, **Risco identificado** e **Hipótese**.

---

## 1. Diagnóstico Executivo dos Maiores Problemas do KÔMA

### 1.1 Problemas Confirmados
1. **Homologação física Bluetooth pendente em hardware real do 3º cliente:**
   - Os testes JVM (ESC/POS 58/80 mm + reuso após 401) estão verdes, porém ainda não há validação física executada em aparelho Android + térmica Bluetooth real seguindo [`docs/operations/homologacao-fisica-bluetooth.md`](./homologacao-fisica-bluetooth.md) (tela bloqueada 2+ min, troca WhatsApp ↔ KÔMA e queda de energia sem duplicar via).
2. **APK Android publicado ainda é `debug` (`KOMA-Print-Android-v1.2.0-debug.apk`):**
   - Adequado para instalação lateral assistida durante homologação técnica, **inadequado** para distribuição comercial em massa ou Play Store enquanto não houver keystore de `release` configurado com armazenamento seguro de credenciais pelo fundador.
3. **Varreduras `O(N_tenants)` no Super Admin e no worker de reconciliação (`_discover_restaurant_ids`):**
   - Presente em `super_admin_access.py`, `super_admin_catalog_assistance.py`, `super_admin_finance.py`, `super_admin_founders.py`, `super_admin_onboarding.py`, `super_admin_incidents.py` e `reconciliation_worker.py`. Cada página/job itera por todos os tenants abrindo scopes individuais — fator confirmado por trás de picos p95 altos observados em produção (`30.000ms` registrado na janela pré-PR #1546).
4. **Build frontend pesado (`dist/assets/` ~`5.7 MB` sem gzip) + polling redundante na montagem do Caixa:**
   - Chunks grandes observados no build real: `CaixaPanel` (`495 KB` JS / `148 KB` CSS), `app.css` (`381 KB`), `chartTheme` (`361 KB`), `CardapioPage` (`335 KB`), `SuperAdminGate` (`331 KB`), além de PNGs pesados em `src/assets/` (`1.15 MB` + `528 KB`) e duplicidade de logo (`135.934` bytes).
   - No walkthrough em navegador real surgiram `~27` `setInterval`, erros de console WebSocket quando em background e múltiplos GETs duplicados abortados (`status: 0`) na montagem de `/?view=caixa`.
5. **Rate limiter crítico em memória por processo Python (`IPRateLimiter`):**
   - Contadores públicos (`/api/provisioning/public/start`, `/auth/login`, `/api/leads`) zeram a cada deploy/restart no Railway e não se compartilham entre réplicas futuras.
6. **Duplicação de regras de parser e presets entre Frontend (TS) e Backend (Python):**
   - `expressOnboardingParser.ts` / `menuImportParser.ts` / `segmentCategoryPresets.ts` espelham `express_provisioning_parser.py` e `universal_presets.py`.
7. **Monólitos backend & 4 `declarative_base()` separados:**
   - Arquivos extensos (`print_agents.py` ~112 KB, `models.py` ~106 KB, `caixa.py` ~80 KB, `customer_crm.py` ~78 KB, `orders/service.py` ~72 KB) e 4 bases ORM (`Base`, `ContractEvidenceBase`, `SignupBase`, `FinanceBase`) aumentam atrito de manutenção e testes.
8. **Micro-atritos visuais pontuais observados no browser QA (não bloqueantes):**
   - Barra de busca da aba `Produtos` sobrepôs botões em largura intermediária; `beacon.min.js` da Cloudflare Web Analytics é bloqueado pela diretiva restritiva `script-src 'self'` no console do navegador.

### 1.2 Riscos Identificados
1. **Custos fixos ociosos no projeto Railway (`passionate-truth`):** presença de 6 serviços/recursos quando o backend principal já utiliza PostgreSQL do Supabase (detalhamento na Seção 3).
2. **Alocação dual de Tenant ID (`reserve_superadmin_tenant_id` vs `reserve_sequential_tenant_id`):** mitigada por `inspect_tenant_id_eligibility` + preservação imutável de `super_admin_audit_logs`, mas exige manter `GLOBAL_SHARED_TABLES` e verificações históricas atualizadas sempre que novas tabelas surgirem.

### 1.3 Gargalos para 10 Clientes vs 100 Clientes
- **Para atender 10 clientes (estado atual):** **desbloqueado no núcleo de software** (provisionamento autônomo/expresso/MCP, segurança multitenant, activation automática com `KOMA_SAAS_MANUAL_RELEASE_REQUIRED=false`, meios de pagamento consistentes e desligamento auditado com limpeza de Storage). Faltam apenas a **validação física Bluetooth no 3º cliente** e eventual saneamento FinOps no Railway.
- **Para atender 100 clientes sem degradação ou trabalho manual proporcional:**
  1. Eliminar os 6+ loops `O(N_tenants)` do Super Admin/workers migrando para consultas SQL agregadas e paginadas;
  2. Migrar `IPRateLimiter` crítico para store compartilhado (Postgres/Supabase ou Redis);
  3. Eliminar GETs duplicados na inicialização do Caixa e fatiar chunks frontend + comprimir PNGs;
  4. Consolidar parser/presets em endpoint único no backend (`/api/provisioning/public/preview` / presets);
  5. Assinar APK comercial Android (`release` keystore + atualização distribuível).

---

## 2. KÔMA Print Android (`android-print-v1.2.0-preview`) — Diagnóstico Técnico e Distribuição

- **Tag oficial publicada:** `android-print-v1.2.0-preview` (Pre-Release).
- **Commit de origem na `main`:** `2e2ef2625df050bbd90000ceaa87e3b7a96e0e42` (workflow CI `46158898212` verde).
- **Artefato:** `KOMA-Print-Android-v1.2.0-debug.apk` (`1.011.113` bytes, SHA-256 `9102898b3dccc5af1b3b234fe7b1a46e307b54253f35942d076abb061a171e0c`).
- **Configuração de build (`print-android/app/build.gradle.kts`):**
  - `applicationId`: `br.com.koma.print.app`
  - `minSdk`: `26` (Android 8.0+), `targetSdk`: `36`, `versionCode = 3`, `versionName = "1.2.0"`
- **Permissões Bluetooth & Background (`AndroidManifest.xml`):**
  - Android 8–11 (`maxSdkVersion="30"`): `BLUETOOTH`, `BLUETOOTH_ADMIN`
  - Android 12+ (`API 31+`): `BLUETOOTH_CONNECT` (sem exigir permissão de GPS)
  - Serviço contínuo: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `POST_NOTIFICATIONS`
- **Avaliação de Assinatura, Atualização e Distribuição Comercial:**
  - **Homologação física imediata:** o APK `debug` é **apropriado e funcional** para testes em campo e no 3º cliente (instalação direta via download, sem custo adicional), **contanto que** todas as instalações de homologação usem o mesmo tipo de assinatura (`debug` da mesma origem CI).
  - **Bloqueio para escala comercial (Google Play / atualização automática):** um APK assinado com certificado `debug` **não pode** ser atualizado *in-place* para um futuro build `release` sem desinstalar/reinstalar no celular dos restaurantes (assinaturas incompatíveis), nem aceita envio à Google Play Store.
  - **Próximo passo quando escalar distribuição comercial (sem criar custos agora):** gerar keystore `release` privado sob guarda do fundador + secrets CI (`ANDROID_KEYSTORE_BASE64`, aliases/senhas) para compilar `assembleRelease` assinado.

---

## 3. Auditoria FinOps do Railway (`passionate-truth`, janela de 7 dias / 10.081 amostras)

> *Transparência:* os endpoints de telemetria consultados via `railway_mcp` reportam CPU, RAM, Disco/Volume e Rede em `7d`, **não valores faturados em US\$/R\$ por serviço**; por isso não inventamos economia em dólares sem acesso à fatura. O objetivo comercial continua sendo o piso Hobby de **US\$ 5/mês**.

| Recurso | Finalidade | Dependências | Uso observado (7 dias) | Economia possível | Risco ao alterar | Recomendação |
|---|---|---|---|---|---|---|
| **`Kôma`** (backend principal) | API FastAPI + WebSocket + Outbox + MCP (`@main`, `sfo`) | Supabase Postgres, Supabase Storage, Resend, Mercado Pago | `0.0067` vCPU méd / `0.2382 GB` RAM méd (`0.4541 GB` máx), tráfego real ativo | Nenhuma (núcleo único em produção) | Máximo (indisponibilidade total) | **Manter** e monitorar |
| **`evolution-api`** (`v2.3.7`) | Automação WhatsApp não-oficial | `Postgres` (Railway), `Redis` (Railway), `evolution-api-volume` (`5 GB`) | `0.0001` vCPU, **`0.2304 GB` RAM contínua**, **`0.0000 GB` rede TX** (`0.0833 GB` em `5 GB`), e `KOMA_WHATSAPP_AUTOMATION_ENABLED="false"` em `Kôma` | Alta redução de RAM (~48% da RAM não-kernel se desligar trio WhatsApp) + `5 GB` disco | Baixo enquanto `KOMA_WHATSAPP_AUTOMATION_ENABLED=false`; **médio** se reativar automação ou se houver instância externa usando | **Confirmar com o fundador** e desligar/remover se nenhum cliente usar WhatsApp automático |
| **`Postgres`** (Railway `postgres-ssl:18`) | Banco auxiliar consumido por `evolution-api` + `Postgres S3 Backup` | `evolution-api`, `Postgres S3 Backup`, `postgres-volume` (`500 MB`) | `0.0001` vCPU, `0.0769 GB` RAM, `0.1271 GB` / `500 MB` | Média (RAM + 500 MB disco) | Baixo **somente** após confirmar que `Kôma` e automações ativas não dependem dele | **Manter só enquanto `evolution-api` existir**; desligar junto se `evolution-api` for removida |
| **`Redis`** (`redis:8.2.9`) | Cache de sessões da `evolution-api` (`CACHE_REDIS_URI`) | `evolution-api`, `redis-volume` (`500 MB`) | `0.0020` vCPU, `0.0188 GB` RAM, `0.0545 GB` / `500 MB` | Baixa (RAM + 500 MB disco) | Zero para `Kôma` (runtime `Kôma` tem 0 client Redis) | **Desligar junto com `evolution-api`** |
| **`Postgres S3 Backup`** | Cron diário `0 3 * * *` de backup do Postgres auxiliar | `Postgres` (Railway) + bucket S3 | Execução diária agendada | Marginal | Zero se `Postgres` auxiliar for removido após snapshot final | Remover somente após encerrar `Postgres` auxiliar |
| **`pre-purge-backup-20260916`** | Snapshot legado de 16/09/2026 (`postgres-ssl:18` + bucket `sjc`) | Histórico pré-purge de setembro/2026 | **`0.0000` CPU**, **`0.0000 GB` RAM**, `0.0000 GB` disco | Pequena (despolui ambiente + bucket legado se exportado) | Irreversível se contiver único backup histórico desejado | Exportar/arquivar fora do Railway se necessário e **remover após aprovação do fundador** |
| **`sistema-gourmet-bistro-volume`** | Volume desconectado (`unattached`, `500 MB`, `sfo`) | Nenhum serviço anexado | `32 MB` usados / `500 MB` alocados, **sem serviço montado** | Libera `500 MB` de cobrança ociosa de volume | Mínimo (já desconectado), validar apenas se restou arquivo antigo | **Excluir imediatamente após aprovação do fundador** |
