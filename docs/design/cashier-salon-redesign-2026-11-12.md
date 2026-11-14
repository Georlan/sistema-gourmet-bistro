# KÔMA — Salão do Caixa e escolha de mesa no PDV (12/11/2026)

## Objetivo e referência
Refatoração do Salão do **Caixa** a partir de capturas reais do painel atual e do Salão do **Garçom**. Unificar linguagem visual e reconhecimento da marca, sem juntar seus fluxos de negócio. A grade compacta, os números grandes e os glifos de estado do Garçom orientam a composição do Caixa, não a cópia de lógica. O código do Garçom não é alterado.

Fontes de design: `docs/design-system/DESIGN_SYSTEM.md`, `docs/design/cashier-visual-direction.md`, `src/styles/komaFoundation.css`.

## Decisões implementadas

- Salão com tipografia Inter/Space Grotesk, superfície e ação dos tokens KÔMA em claro/escuro, card de mesa compacto e número dominante. O nome personalizado aparece sem repetir o rótulo “Mesa”. Glifos de estado existentes (`KomaWaiterGlyph`) substituem decoração nova.
- Filtros por situação, busca por identificador/nome (inclusive zero à esquerda, “07”), estados vazios e de falha; resumo conserva apenas dados recebidos da projeção, sem declarar total consumido como saldo a receber.
- Ação de mesa continua contextual: abrir pedido em mesa livre; em atendimento, ver comanda ou adicionar consumo quando não há linhas; mesclagem não cria ação duplicada.
- Salão → Novo Pedido preserva a modalidade `dine_in`, o ID canônico e mostra claramente “Pedido para Mesa XX”, inclusive enquanto o operador vê o catálogo.
- Troca de mesa deixa o `<select>` nativo e usa diálogo visual próprio com pesquisa, filtros, estados e confirmação por clique na mesa. `Sem mesa` continua possível segundo as regras atuais do PDV; Escape fecha e devolve o foco.
- Código visual não dispara lançamentos, cobranças, pagamentos ou transferências. Permanecem `useCashierPdv`, `projectCashierSalonTables`, e os callbacks originais como responsáveis pelo estado e regras. Nenhum endpoint, dependência, novo SVG ou fotografia foi adicionado.

## Verificação e aceite

- TypeScript, build e testes focais de projeções do Salão.
- Playwright com backend fictício: grade e busca, navegação da mesa para PDV, alteração da mesa, retorno do foco, nenhum POST financeiro durante seleção, prevenção de regressão em carrinho e retry.
- Layout: 320–430 px, tablet e desktop, temas claro/escuro, zoom e texto grande; testar física e visualmente antes da publicação.
- Testes legados que ainda buscavam o `<select>` ou rótulos removidos antes desta alteração foram adaptados para contratos atuais, com confirmação da falha também na `main` original quando aplicável.
- **Merge/deploy somente após CI verde e avaliação da prévia em dispositivo real**; não testar pedidos reais em produção durante homologação estética.
