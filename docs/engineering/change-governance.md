# Governança de mudanças

## Quality gates de merge

A proteção ativa de `main` usa o ruleset **Protect main branch**. Seu único status obrigatório é `Merge verdict` (GitHub Actions), com a branch atualizada em relação à base (`strict_required_status_checks_policy: true`), PR obrigatório e threads de revisão resolvidas. Não há atores com bypass. Consulte o ruleset novamente antes de integrar: a configuração do GitHub é a fonte de verdade dos checks exigidos.

`Merge verdict` executa `.github/workflows/quality-gate.yml` (**Koma Minimal Gate**): TypeScript (`npm run lint`), suíte unitária frontend (`npm run test:unit`, cobrindo todos os `tests/*.test.ts`), build de produção (`npm run build`) e compilação sintática de `backend/app`. Quando o detector de paths sensíveis é acionado, também executa no mesmo check:
- validação de head único do Alembic (`alembic heads == 1`) ao tocar migrations ou modelos;
- regressões focais de autenticação, onboarding, cobrança, planos e otimização (`run`);
- regressões rápidas SQLite de pedidos, pagamentos, caixa, estoque e atendimentos (`orders_payments_inventory`);
- execução automática de arquivos `backend/tests/**/test_*.py` alterados/adicionados no PR compatíveis com SQLite (`changed_tests`);
- contrato de impressão de agentes instalados (`backend/tests/test_print_agents.py`) ao tocar backend, `print-agent/`, configuração Railway/Docker ou `quality-gate.yml`;
- isolamento e replay concorrente fiscal em PostgreSQL local temporário (`docker run postgres:17-alpine`) com exigência de zero testes pulados.

Os antigos contexts `Frontend typecheck + unit + build`, `Backend full + critical regression gate`, `Browser regression matrix` e `postgres-security-audit` não são os status obrigatórios atuais. Não procurar esses nomes como evidência de execução nem confundir checks ausentes com verdes.

## Consolidação de CI/CD e validação adicional por risco

O requisito do ruleset é o mínimo para integrar; não substitui a revisão nem os testes pertinentes à mudança. Os antigos workflows fragmentados foram consolidados em **14 workflows** orientados a risco, com cancelamento automático de execuções obsoletas em PRs (`concurrency`) e cache de dependências/Playwright:

- **`.github/workflows/postgres-critical-boundaries.yml` (`PostgreSQL Critical Boundaries`)**: executa em `pull_request` (apenas para os domínios de persistência/concorrência/RLS/Alembic alterados) e diariamente às `05:45 UTC` (`schedule` + `workflow_dispatch`), cobrindo em um único container `postgres:17-alpine` com bancos lógicos isolados: segurança multitenant/RLS (`koma_app`, `anon`, `authenticated`), lineage e downgrade/re-upgrade Alembic, corridas de pagamento por item e Direct Pix, corridas de estoque, transferências/pedidos concorrentes, CRM, chat, catálogo Marmitaria, imagens de produto, workers/outbox, staff push e realtime multiprocesso.
- **`.github/workflows/browser-targeted-gate.yml` (`Browser Targeted Gate`)**: executa em `pull_request` (roteando apenas as specs Playwright afetadas pelos arquivos alterados em `mobile-390` + `desktop-1366` ou preview específico) e diariamente às `06:45 UTC` (`schedule` + `workflow_dispatch`) para a regressão ampla, matrizes multi-viewport e Firefox preview.
- **`.github/workflows/backend-full-suite.yml` (`Backend Full Suite`)**: executa a suíte completa `pytest backend/tests` diariamente às `06:15 UTC` e por disparo manual (`workflow_dispatch`), evitando atrasar PRs e hotfixes focais cujo escopo já é validado no `Merge verdict` e em `PostgreSQL Critical Boundaries`.
- **Workflows especializados e operacionais mantidos:** `backend-dependency-health.yml` (auditoria npm/pip em mudanças de manifesto e semanal), `secret-scan.yml` (Gitleaks), `print-agent.yml`, `print-agent-public-release.yml`, `koma-print-android.yml`, `smartpos-android-bridge.yml`, `main-push-safety-gate.yml`, `production-smoke.yml`, `external-availability-monitor.yml` e `backup-freshness-monitor.yml`.

Para procedimentos de incidente e entrega rápida em produção, consulte [`docs/operations/hotfix-emergency-playbook.md`](../operations/hotfix-emergency-playbook.md).

Não integrar com falhas relevantes abertas nem com validações necessárias pendentes. Preview Cloudflare e status Railway não substituem testes.

## Segurança após integração e publicação

`Main Push Safety Gate` roda a cada push em `main`: typecheck, testes unitários e build frontend; head Alembic único e smoke crítico backend. Esse workflow é uma verificação pós-merge, não a suíte backend completa.

Após deploy, confira o commit ativo na API e o deployment Railway. Execute `node scripts/production-smoke.mjs`; quando validar uma publicação específica, forneça `KOMA_EXPECTED_API_SHA` (40 caracteres) e `KOMA_EXPECTED_FRONTEND_SHA`. Um smoke verde sem conferir o SHA prova saúde da versão servida, não que a nova versão foi publicada.

## Eficiência sem regressão: contrato de mudança

Pedidos de economia, eficiência, redução de consumo ou refatoração preservam os fluxos existentes. Não autorizam sacrificar disponibilidade, latência operacional, segurança, idempotência, isolamento ou compatibilidade com instalações reais. A regra alcança código, banco e configurações Railway/Supabase; mudanças pelo painel também precisam de baseline, validação e reversão.

Antes da mudança, identificar consumidores e registrar comportamento/versão, estado da fila, TTLs e sinais de saúde. Simular com fixtures o fluxo completo: criar trabalho, receber diagnóstico, reservar, confirmar e repetir confirmação sem duplicar. Avançar relógio virtual além das janelas de validade, mantendo conteúdo idêntico; testar também ausência de relatório, desconexão e recuperação. Nunca substituir esse ensaio por pedidos, pagamentos ou impressão de teste no ID 6.

Incidente de 11/10/2026: a PR #1082 parou de renovar `diagnostics_updated_at` quando o conteúdo não mudava. Após 90 s, o backend respondia `200` e lista vazia no claim, com agente online e fila pendente. A PR #1083 restaurou a validade na transação agrupada. O teste `test_stable_legacy_agent_prints_after_multiple_freshness_windows` simula três minutos do protocolo instalado, reserva e confirma trabalho, preserva outro tenant e impede nova reserva do mesmo trabalho.

O check obrigatório `Merge verdict` passa a executar o contrato de impressão quando backend, agente instalado, workflows de qualidade/impressão ou configuração Railway/Docker da raiz mudar. A verificação é por arquivos, sem depender do autor chamar a PR de "otimização". O ruleset do GitHub continua sendo a fonte de verdade de obrigatoriedade; o teste vive dentro do check já exigido, sem criar um status opcional como única proteção.

Mudanças fiscais também acionam no `Merge verdict` as regressões de FKs/RLS e replay concorrente, em PostgreSQL local temporário. O detector cobre núcleo/rotas/serviços/testes fiscais, migrations fiscais, modelos/autenticação/banco compartilhados, telas fiscais e o próprio workflow. O step recusa testes pulados e remove o container ao terminar; não cria infraestrutura de homologação na nuvem.

Antes de publicar, registrar no PR evidência antes/depois, compatibilidade instalada, riscos da fila acumulada e plano de reversão. Após publicação, conferir SHA servido e comportamento real em leitura durante mais de uma janela de TTL afetada. Em regressão, interromper a expansão da mudança e executar a reversão segura; não apagar fila nem repetir efeitos físicos para mascarar problema. Saúde HTTP, confirmação pelo spooler e papel impresso são evidências distintas.

## Regra de evidência

- `main` deve permanecer verde.
- Falha real não é corrigida relaxando um contrato sem justificar a intenção do teste.
- Testes de governança devem distinguir tabelas globais, tabelas tenant-owned do runtime e tabelas tenant-owned operadas explicitamente pelo control plane.
- Quando um teste está verificando uma regra de domínio persistida, prefira validar o estado canônico no banco/serviço em vez de acoplar a regressão a um detalhe opcional da resposta HTTP.
