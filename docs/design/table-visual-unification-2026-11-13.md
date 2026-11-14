# KÔMA — leitura operacional de mesas no Caixa e no PDV

## Problema observado

Capturas reais do app mostram Salão com mesas ocupadas quase indistinguíveis das livres e seletor PDV com uma segunda linguagem visual (somente livre/em atendimento), mesmo quando o estado canônico é `ready` ou `payment`. O resumo e o botão da mesa escolhida usam exclusivamente destaque verde, omitindo a situação operacional. A clareza de estado depende demais de ler descrições longas. O Garçom já possui linguagem com cabeçalho tonal rosa para ocupado e menta para item pronto.

## Direção aprovada pelo pedido

Usar `tableCardPresentation(operational)` — que já prioriza pagamento, item pronto, produção e livre — em Salão, seletor e blocos de mesa do Novo Pedido. Paleta de superfície e cabeçalho próprias por estado, com padrões claros e escuros, mas a marca turquesa continua nas ações do produto. Nenhuma métrica, consumo ou SLA inventado. Cor não é único sinal: manter texto de status e ícone de mesa. Reutilizar `KomaWaiterGlyph`, sem novas imagens (ilustração não melhora seleção operacional).

### Estados apresentados (prioridade de domínio inalterada)

- `free`: verde-floresta discreto, `Livre` + capacidade; abre pedido.
- `occupied` / `served`: rosa/vinho bem contrastado, `Em preparo`/`Em atendimento`/`Itens servidos` conforme projeção; mostra consumo atual e tempo se disponível, inspeciona atendimento.
- `ready`: menta mais viva, `Tem item pronto`; não confundir com mesa livre.
- `payment`: azul operacional, `Aguardando pagamento` ou `Confirmar pagamento`.
- `merged`: neutro tracejado, aponta a mesa destino, preserva a regra de elegibilidade atual.

### Componentes e responsabilidades

- `SharedTableCard.tsx`: continua sendo a autoridade da *apresentação de estado* com `tableCardPresentation`.
- `TableStatusMark.tsx`: indicador reutilizado, sem lógica de pedido.
- `tableOperationalVisual.css`: tokens locais e sistema visual compartilhado para Salão, escolha e resumo; escopo por data-operational-state, tema e superfícies.
- `CashierSalonCard.tsx`: preserva click/aria/ID sem nova ação; vincula status visual canônico.
- `CashierPdvTablePicker.tsx`: exibe estado canônico por mesa, mesmo em resultado selecionado; mantém seleção imediata, busca, filtro e `Sem mesa`.
- `CashierPdvView.tsx`: contexto superior e gatilho do carrinho mostram o mesmo estado e valor disponível, sem dados fictícios.
- `CashierTableDestinations.tsx`: destinos de transferência/mesclagem/vínculo preservam o contrato legado (`isOccupied`) e agora usam rosa/vinho para ocupada, verde para livre, com texto explícito e sem alterar o radiogroup/confirmar. Não projetar `ready` nem `payment` se os dados do modal não os sustentarem.

## Qualidade e limitações

Testar em 320, 390, 430px e desktop, claro/escuro, uma mesa pronta, ocupada, livre e com pagamento, troca e remoção da mesa, foco/teclado e ausência de scroll horizontal. Não tocar backend, banco, checkout, preço, pagamento ou tenants reais. PR e CI verde antes de deploy; smoke produção somente leitura. A escolha de mesa **não** dá baixa nem conclui serviço.

## Verificação prática

- TypeScript/lint e build passaram. 1.259/1.259 testes unitários passaram.
- 87 testes Playwright passaram (13 skipped por viewport) sobre Salão, PDV, busca de mesa, edição/checkout, retry após erro e seleção em celular/desktop, **antes** da expansão para transferência.
- Após expandir para transferência, 25 testes passaram e 1 foi ignorado no conjunto específico de Salão + destino no PDV + transferência/mesclagem, com teste novo que distingue ocupado/livre, verifica contraste e não permite mutação antes de confirmar.
- Capturas de 390px em dark/light inspecionadas. Teste novo verificou contraste renderizado do texto e do cabeçalho >= 4,5:1 em ambos os temas, inclusive após troca sem transição intermediária; os alvos têm tamanho útil e o modal cabe entre 320 e 430px sem scroll horizontal.
- Correções visuais relevantes comprovadas: regras antigas forçavam todo `span` de status do picker a 0,4rem, quebrando a leitura; removidas essas regras. Transição anterior de fundo de cartão criava instante com contraste ~1,7:1 ao alternar tema; desativada para esses cartões, sem motion gratuito.
- Glyphs existentes (`KomaWaiterGlyphs.tsx`) foram reaproveitados. Nenhuma imagem ilustrativa ou dependência de IA foi necessária, pois é um problema de comunicação de estado, não de material publicitário.
