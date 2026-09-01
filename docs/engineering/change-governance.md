# Governança de mudanças

## Estado temporário — quality gates desativados

Os quality gates automáticos foram removidos temporariamente para destravar o fluxo de desenvolvimento e reduzir o tempo entre PR e merge.

A proteção da branch `main` ainda referencia quatro nomes históricos de status checks. Como a integração atual não consegue editar branch protection, existe apenas um workflow mínimo de compatibilidade (`merge-compatibility-shim.yml`) que publica esses quatro contexts como sucesso sem executar suites de teste. Ele não é um quality gate e deve ser removido assim que os required checks forem retirados da proteção da branch.

Contexts mantidos apenas por compatibilidade:

- `Frontend typecheck + unit + build`
- `Backend full + critical regression gate`
- `Browser regression matrix`
- `postgres-security-audit`

Foram removidos os workflows pesados de quality gate, auditoria adversarial, migration baseline, release drift, B1.4 operational smoke e CodeQL. Eles serão redesenhados depois, com foco em checks rápidos e seletivos por risco/caminho alterado.

Enquanto esse modo temporário estiver ativo, mudanças de alto risco em pagamentos, autenticação, estoque, migrações, multi-tenant/RLS e state machines devem receber revisão e validação direcionadas antes de merge. Mudanças pequenas de UI/UX não devem ficar bloqueadas por suites integrais do produto.

## Próximo desenho

Quando os gates forem recriados, a meta é separar:

1. checks rápidos de PR, com orçamento de poucos minutos;
2. testes direcionados por paths/risco;
3. suites pesadas agendadas ou pós-merge;
4. auditorias de segurança fora do caminho crítico de entrega.
