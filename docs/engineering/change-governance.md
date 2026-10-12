# Governança de mudanças

## Quality gates de merge

A proteção ativa de `main` usa o ruleset **Protect main branch**. Em 29/09/2026,
seu único status obrigatório é `Merge verdict` (GitHub Actions), com a branch
atualizada em relação à base, PR obrigatório e threads de revisão resolvidas.
Não há atores com bypass. Consulte o ruleset novamente antes de integrar:
a configuração do GitHub é a fonte de verdade dos checks exigidos.

`Merge verdict` executa `.github/workflows/quality-gate.yml` (**Koma Minimal
Gate**): TypeScript, suíte unitária frontend, build de produção e compilação
sintática de `backend/app`. Quando o detector de paths sensíveis é acionado,
também executa regressões focais de autenticação, onboarding, cobrança, planos
e otimização. Esse detector não equivale à cobertura de todo o backend.

Os antigos contexts `Frontend typecheck + unit + build`, `Backend full +
critical regression gate`, `Browser regression matrix` e
`postgres-security-audit` não são os status obrigatórios atuais. Não procurar
esses nomes como evidência de execução nem confundir checks ausentes com verdes.

## Validação adicional por risco

O requisito do ruleset é o mínimo para integrar; não substitui a revisão nem
os testes pertinentes à mudança. Pagamentos, estoque, autenticação,
multi-tenant/RLS, migrations e state machines exigem regressões direcionadas,
incluindo concorrência e isolamento quando aplicável.

- `Backend Full Suite` (`Full backend pytest`) executa a suíte completa em PRs
  que alteram `backend/tests/**`, ou por disparo manual. Alterar somente código
  backend não garante que esse workflow seja iniciado automaticamente.
- Os workflows focais em `.github/workflows/` possuem seus próprios filtros:
  verificar quais realmente rodaram no SHA atual, suas conclusões e logs.
- Mudanças em migrations devem validar head único e lineage PostgreSQL.
- Regressões de browser devem cobrir os fluxos operacionais afetados.

Não integrar com falhas relevantes abertas nem com validações necessárias
pendentes. Preview Cloudflare e status Railway não substituem testes.

## Segurança após integração e publicação

`Main Push Safety Gate` roda a cada push em `main`: typecheck, testes unitários
e build frontend; head Alembic único e smoke crítico backend. Esse workflow é
uma verificação pós-merge, não a suíte backend completa.

Após deploy, confira o commit ativo na API e o deployment Railway. Execute
`node scripts/production-smoke.mjs`; quando validar uma publicação específica,
forneça `KOMA_EXPECTED_API_SHA`. Um smoke verde sem conferir o SHA prova
saúde da versão servida, não que a nova versão foi publicada.

## Eficiência sem regressão: contrato de mudança

Pedidos de economia, eficiência, redução de consumo ou refatoração preservam os fluxos existentes. Não autorizam sacrificar disponibilidade, latência operacional, segurança, idempotência, isolamento ou compatibilidade com instalações reais. A regra alcança código, banco e configurações Railway/Supabase; mudanças pelo painel também precisam de baseline, validação e reversão.

Antes da mudança, identificar consumidores e registrar comportamento/versão, estado da fila, TTLs e sinais de saúde. Simular com fixtures o fluxo completo: criar trabalho, receber diagnóstico, reservar, confirmar e repetir confirmação sem duplicar. Avançar relógio virtual além das janelas de validade, mantendo conteúdo idêntico; testar também ausência de relatório, desconexão e recuperação. Nunca substituir esse ensaio por pedidos, pagamentos ou impressão de teste no ID 6.

Incidente de 11/10/2026: a PR #1082 parou de renovar `diagnostics_updated_at` quando o conteúdo não mudava. Após 90 s, o backend respondia `200` e lista vazia no claim, com agente online e fila pendente. A PR #1083 restaurou a validade na transação agrupada. O teste `test_stable_legacy_agent_prints_after_multiple_freshness_windows` simula três minutos do protocolo instalado, reserva e confirma trabalho, preserva outro tenant e impede nova reserva do mesmo trabalho.

O check obrigatório `Merge verdict` passa a executar o contrato de impressão quando backend, agente instalado, workflows ou configuração Railway/Docker da raiz mudar. A verificação é por arquivos, sem depender do autor chamar a PR de "otimização". O ruleset do GitHub continua sendo a fonte de verdade de obrigatoriedade; o teste vive dentro do check já exigido, sem criar um status opcional como única proteção.

Mudanças fiscais também acionam no `Merge verdict` as regressões de FKs/RLS e replay concorrente, em PostgreSQL local temporário. O detector cobre núcleo/rotas/serviços/testes fiscais, migrations fiscais, modelos/autenticação/banco compartilhados, telas fiscais e o próprio workflow. O step recusa testes pulados e remove o container ao terminar; não cria infraestrutura de homologação na nuvem.

Antes de publicar, registrar no PR evidência antes/depois, compatibilidade instalada, riscos da fila acumulada e plano de reversão. Após publicação, conferir SHA servido e comportamento real em leitura durante mais de uma janela de TTL afetada. Em regressão, interromper a expansão da mudança e executar a reversão segura; não apagar fila nem repetir efeitos físicos para mascarar problema. Saúde HTTP, confirmação pelo spooler e papel impresso são evidências distintas.

## Regra de evidência

- `main` deve permanecer verde.
- Falha real não é corrigida relaxando um contrato sem justificar a intenção do teste.
- Testes de governança devem distinguir tabelas globais, tabelas tenant-owned do runtime e tabelas tenant-owned operadas explicitamente pelo control plane.
- Quando um teste está verificando uma regra de domínio persistida, prefira validar o estado canônico no banco/serviço em vez de acoplar a regressão a um detalhe opcional da resposta HTTP.
