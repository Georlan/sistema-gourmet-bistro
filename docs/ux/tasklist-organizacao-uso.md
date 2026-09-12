# KÔMA — Tasklist de organização e facilidade de uso

Este tracker é executável: cada item deve resultar em mudança concreta, teste e PR pequeno. Auditoria passiva não conta como conclusão.

## P0 — Operação diária

- [x] Caixa: remover Pix presumido do checkout e exigir escolha explícita do método.
- [x] Caixa: abrir recebimento de mesa sem pré-selecionar itens prontos; o saldo pode vir preenchido, mas permanece visível e editável.
- [ ] Caixa: reconstruir a sincronização do Kanban/recebimento ainda pendente no PR #319 sobre a main atual.
- [ ] Caixa: revisar hierarquia visual do checkout em mobile e desktop com fluxo real de recebimento.
- [ ] App do Garçom: testar fluxo mesa livre → pedido → consumo → fechamento em mobile real/simulado e remover passos redundantes.
- [ ] Impressão: consolidar diagnóstico, configuração e teste em uma sequência operacional curta.

## P1 — Organização do produto

- [ ] Cardápio Online: reconstruir a UX de cliente bloqueado/motivo da recusa do PR #328 sobre a main atual.
- [ ] Cardápio Online: reduzir navegação e configurações duplicadas; manter poucos fluxos canônicos.
- [ ] Super Admin: organizar ações do tenant por tarefa operacional e destacar estados/ações perigosas.
- [ ] Onboarding: transformar primeiro acesso em sequência curta de decisões essenciais, sem bloquear o Caixa.
- [ ] Equipe: deixar hierarquia de cargos/permissões mais explícita e impedir ações administrativas ambíguas.

## P1 — Integridade que afeta a operação

- [ ] Outbox: tornar idempotente também a colisão do mesmo `event_id` entre transações concorrentes.
- [ ] Estoque: auditar e serializar writers restantes de entrada manual/XML/movimentações administrativas.
- [ ] Entregador: adicionar timeout/recuperação ao POST de confirmar entrega sem criar retry duplicado.

## P2 — Limpeza e simplificação

- [ ] Chat: reavaliar e reconstruir a retenção de 90 dias do PR #317 sobre a arquitetura atual.
- [ ] Navegação do Caixa: validar agrupamentos, nomes e destinos com uso real; remover rotas/atalhos redundantes.
- [ ] Relatórios: manter somente atalhos e indicadores que levam a decisão operacional clara.
- [ ] Configurações: consolidar owners existentes e impedir novas telas paralelas para a mesma regra.

## Regra de execução

1. Partir sempre da `main` mais recente.
2. Resolver uma fatia coerente e invasiva o suficiente para melhorar o produto de verdade.
3. Adicionar regressão automatizada quando possível.
4. Rodar gates relevantes e mergear somente verde e com head estável.
5. Teste manual do usuário/Gemini acontece depois do merge; achados viram a próxima fatia concreta.
