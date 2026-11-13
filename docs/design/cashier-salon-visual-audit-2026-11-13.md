# Auditoria visual — Salão do Caixa (13/11/2026)

## Evidência e princípio

A versão de `e0311643` acrescentou um título repetido, a microheadline "ATENDIMENTO NO LOCAL", uma frase explicativa, três caixas de métricas e uma moldura extra para filtros/mesas. Esses elementos ocupavam a primeira dobra sem facilitar a ação. A referência correta é a **composição do Garçom para mesas** e a **navegação/controles do Caixa**. O Entregador comprova o uso da marca e da hierarquia no contexto próprio; seu destaque ilustrado contextual não é modelo para um catálogo de mesas.

### Fontes de verdade verificadas
- `AGENTS.md` e `.agents/AGENTS.md`: preservar fluxos e estados, operar por branch/PR, sem produção sintética.
- `docs/design-system/DESIGN_SYSTEM.md`, `COMPONENTES.md`, `VISUAL-2026-11-02.md`: Inter (UI), Space Grotesk (identificadores); estados legíveis; alvo touch ≥44 px quando crítico; não duplicar contagens ou aninhar cartões sem função. A referência de novembro documenta **três colunas de Garçom no celular**, e prioriza mesa → estado → ação.
- `src/styles/komaFoundation.css`: `--koma-font-body` / `--koma-font-display`, tokens de tema/contraste/foco e `--koma-operation-*`; manter semântica de situação (pagamento ≠ pronto).
- `src/components/mesas/WaiterTableSurface.tsx`, `waiterOperational.css`, `MesasView.tsx`: cabeçalho compacto de mesa, ícones próprios de estado, busca discreta, grupo segmentado com números e grade 2/3/4/5/6 colunas.
- `src/components/caixa/orders/CaixaOrdersWorkspace.tsx` e `docs/design/cashier-visual-direction.md`: o Caixa já retirou seu antigo resumo `OperationalBanner`; o trabalho nasce nos filtros, nos pedidos e nas ações. Repetir um painel de indicadores no Salão contradiz essa decisão.
- `src/components/courier/CourierRideArtwork.tsx` e `docs/engineering/courier-redesign-integration.md`: ilustração própria vinculada à tarefa de entrega; **não** replicar a arte num Salão que precisa de densidade.
- `src/components/shared/KomaWaiterGlyphs.tsx`: SVGs de estado locais. `public/brand/cashier/README.md`: SVG separado por função, fundo transparente, sem filtro/script/animação ou texto incorporado. `src/brand/komaBrand.ts` / `src/assets/brand/koma/README.md`: marca claro/escuro.
- `docs/design-system/ASSETS.md` e `ASSET_PROVENANCE.md`: asset não é obrigação; direitos de uso precisam de evidência. Não inserir imagens novas nesta correção.
- `.cursor/rules/efficiency-operational-safety.mdc`: continuidade operacional. O repositório não contém um `SKILL.md` de design próprio; o documento de refinamento do Entregador menciona Frontend Design/UI/UX Pro Max/React Best Practices como habilidades **usadas na elaboração**, não como contratos de produção versionados.

## Correção focal

1. Retirar banner, título visível duplicado, frase introdutória, taxa de ocupação e os três cartões de resumo. O título acessível continua, invisível visualmente.
2. Manter filtro e busca diretamente abaixo da aba Salão, em controles com a mesma gramática do Garçom; quatro filtros do Caixa preservam a distinção entre atendimento e recebimento. Não inventar indicadores.
3. Cards com número ou nome customizado, glyph da situação, somente o contexto útil (lugares em mesa livre; valor/tempo/estado especial em mesa ocupada) e uma única ação existente. Sem "Mesa", "Livre" e ícones repetidos como texto secundário em todos os cards.
4. Grade com três colunas a partir de 360 px, duas no celular menor ou com texto gigante; escala maior para tablet/desktop. Remover CSS Pocket legado de uma coluna para a grade antiga.
5. Preservar integralmente callbacks do Salão, projeção financeira/status, destino no PDV, modal de escolha de mesa, modais de detalhe, cobrança e fluxo de lançamentos. Sem novo SVG, backend, fetch ou dependência.

## Validação

Verificações requeridas: TypeScript, unitários, build, E2E Salão/PDV/densidade em celular e desktop, tema claro/escuro, texto gigante, viewport 320–1366 px, PR/CI verde. **Não publicar automaticamente**: validar a nova tela visualmente no dispositivo do operador antes do merge.
