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

## Regra de evidência

- `main` deve permanecer verde.
- Falha real não é corrigida relaxando um contrato sem justificar a intenção do teste.
- Testes de governança devem distinguir tabelas globais, tabelas tenant-owned do runtime e tabelas tenant-owned operadas explicitamente pelo control plane.
- Quando um teste está verificando uma regra de domínio persistida, prefira validar o estado canônico no banco/serviço em vez de acoplar a regressão a um detalhe opcional da resposta HTTP.
