# KÔMA — contexto de trabalho

## Entrega e evidência

- Trabalhar em branch e PR; nunca fazer push direto em `main`, force-push ou contornar checks/proteção.
- Preservar alterações de outras tarefas. Integrar somente após revisão, checks obrigatórios verdes e autorização de merge.
- Testar mudanças de comportamento; distinguir observado, alvo, bug confirmado, intenção, hipótese e não determinado.
- Não corrigir uma diferença visual como bug sem evidência. Mudanças de produto exigem escopo aprovado.
- `npm run lint`, `npm run test:unit`, `npm run build`; backend: `python -m pytest backend/tests -q -ra`.
- Browser: `KOMA_E2E_PORT=4283 npm run test:e2e -- --workers=2`. Manter fontes congeladas durante a execução; não reutilizar servidor de outra tarefa.

## Abrir somente o contexto da tarefa

| Tarefa | Abrir primeiro | Fonte de verdade / contrato |
|---|---|---|
| Criar Pedido | `backend/app/application/orders/` | `service.py` / `commands.py`; adapters em `backend/app/adapters/orders/` |
| Identidade / read models | `docs/architecture/orders_identity_memory.md` | identidade persistida, `src/domain/orderIdentity.ts` |
| Mesa / estado operacional | `docs/architecture/table_projections_memory.md` | `src/domain/operationalState.ts` |
| Caixa / Kanban | `docs/engineering/cashier-ownership.md` | Owners em `src/components/caixa/`; `src/domain/cashierOrderProjection.ts` |
| Integrações / outbox | `backend/app/adapters/orders/` e busca por `IntegrationOutbox` | adapter do canal e serviço de outbox existente |
| Intenção de produto / backlog | `docs/architecture/product_intent_protection.md` | `docs/architecture/phase7_backlog.md` |
| Cardápio público | `src/cardapio/` | `docs/architecture/cardapio_delivery_presentation.md` e `cardapio_addons_direction.md` |
| Landing / dispositivos | `.cursor/rules/landing-device-mockups.mdc` | `docs/landing-*-mockup.md`; preservar visual 3D, alpha real e tela substituível |
| CI / governança | `.github/workflows/quality-gate.yml` | `docs/engineering/change-governance.md` |
| Rotas / aliases HTTP | `docs/engineering/route-ownership.md` | Um responsável por método/URL; preservar contratos e imports explícitos |

## Invariantes essenciais

- AtendimentoMesa = sessão; Comanda = conta financeira; Lancamento = Pedido; Item = item do Pedido.
- ID técnico do Pedido ≠ ID da Comanda; `display_number` persistido ≠ número da Comanda. Não gerar sufixos no frontend.
- Produção, serviço e financeiro são dimensões independentes: PRONTO ≠ AGUARDANDO_PAGAMENTO.
- Preservar fatias Kanban: R$112 em preparo + R$48 prontos = R$160, sem duplicar R$160 nos dois cards.
- Uma Mesa agregada pode conter vários Pedidos; não identificá-la pelo primeiro lançamento.
- Compartilhar apresentação não unifica ações de Caixa/Garçom nem muda regras financeiras.
- Extrair responsabilidade com estado, efeitos e contratos, não fragmentar JSX apenas para reduzir linhas.
- Preservar autenticação, idempotência, cleanup de subscriptions/timers e regras de SmartPOS/pagamento.
- Histórico e decisões extensas ficam nos documentos apontados, não no contexto obrigatório.
