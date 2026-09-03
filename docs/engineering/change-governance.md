# Governança de mudanças

## Quality gates de merge

Os quatro contexts exigidos pela proteção da branch `main` voltaram a executar validações reais em `.github/workflows/quality-gate.yml`.

Checks obrigatórios:

- `Frontend typecheck + unit + build`: TypeScript, suíte unitária frontend e build de produção;
- `Backend full + critical regression gate`: Alembic com head único e suíte completa `backend/tests`;
- `Browser regression matrix`: smoke E2E de owners operacionais e contexto de salão em mobile/desktop;
- `postgres-security-audit`: regressões de CORS, contrato do Super Admin e invariantes multitenant.

O antigo `merge-compatibility-shim.yml`, que publicava sucesso sem executar testes, foi removido. Nenhum PR deve ser mergeado se um desses contexts estiver vermelho ou ausente.

## Estratégia de velocidade

O caminho crítico de PR concentra validações que protegem comportamento, autenticação, tenancy e build sem restaurar toda a antiga matriz pesada em cada alteração.

Auditorias de maior custo, PostgreSQL adversarial completo, concorrência, dependency audit e matrizes browser extensas podem continuar em workflows dedicados, agendados ou pós-merge. Mudanças de alto risco em pagamentos, autenticação, estoque, migrações, multi-tenant/RLS e state machines ainda devem receber testes direcionados adicionais no próprio PR.

Mudanças pequenas de UI/UX não precisam ampliar a suíte além dos gates canônicos e dos testes diretamente afetados.

## Regra de evidência

- `main` deve permanecer verde.
- Falha real não é corrigida relaxando um contrato sem justificar a intenção do teste.
- Testes de governança devem distinguir tabelas globais, tabelas tenant-owned do runtime e tabelas tenant-owned operadas explicitamente pelo control plane.
- Quando um teste está verificando uma regra de domínio persistida, prefira validar o estado canônico no banco/serviço em vez de acoplar a regressão a um detalhe opcional da resposta HTTP.
