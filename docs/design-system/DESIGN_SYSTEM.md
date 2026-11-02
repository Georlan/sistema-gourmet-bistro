# Sistema de design KÔMA

Fonte de referência para novas interfaces e evolução das existentes. Base observada: `214cdc1005fe6063f6bca166d9d97e27164dac58`, 02/11/2026. As orientações abaixo são a direção para trabalho novo; não são declaração de que todas as telas já as implementam. Padrões de operação aprovados, contratos de domínio e acessibilidade prevalecem sobre migrações puramente visuais. Mudanças em produção devem preservar tenant, pagamentos, estado operacional e continuidade.

**Estados de decisão:** existente = implementado no código apontado; direção = especificação deste documento para trabalhos futuros, ainda não demonstrada em todas as telas; exceção = regra contextual preservada; legado = ainda existe, sem recomendação de expansão. Não atribuir aprovação histórica a decisões novas. Quando mudar uma regra, atualizar esta fonte e os consumidores afetados.

## Identidade e perfis

KÔMA é claro, ágil e caloroso; a marca menta convive com superfícies discretas, tipografia legível e informação concreta. O produto deve permitir trabalhar com rapidez sem esconder o que é necessário para uma decisão. Cada elemento destacado precisa ajudar a identificar, decidir ou agir.

- **Compra:** descoberta, fotografia autorizada, produto, preço, disponibilidade e escolhas; aceitar identidade do restaurante sem perder legibilidade. Imagens não devem encobrir preço nem induzir disponibilidade inexistente.
- **Operação:** estado, identificador e próxima ação; alta densidade quando necessária, alvos confortáveis e retorno imediato. Garçom, Caixa e Entregador têm tarefas e semânticas diferentes.
- **Gestão/análise:** filtros compreensíveis, períodos explícitos, alinhamento e comparação de valores; contexto e ausência de dados devem ser distinguidos de zero.

## Tipografia

**Existente:** `--koma-font-body` = Inter, `ui-sans-serif, system-ui, sans-serif`; `--koma-font-display` = Space Grotesk, `sans-serif` em [`komaFoundation.css`](../../src/styles/komaFoundation.css). Inter serve a texto, controles e dados; Space Grotesk a títulos e identificadores com hierarquia. `src/index.css` carrega ainda Montserrat, Bebas Neue e JetBrains Mono: são dependências e usos existentes, não remover sem inventário; monoespaçada é para códigos técnicos e casos já específicos, não regra universal de preço. Fontes externas precisam de revisão de licença, privacidade e medição antes de hospedar ou substituir.

**Direção para novas telas:** usar a mesma escala entre perfis, escolhendo poucos níveis; valores em CSS px para 16 px de referência, escaláveis com `rem` e preferências da interface. Pesos 400 para leitura, 500–600 para rótulo/ação e 700 para títulos; evitar sintetizar pesos não carregados. Line-height e tracking abaixo são pontos de partida, não justificativa para truncar informação.

| Papel semântico | Família | Tamanho / linha | Peso / tracking | Exemplo |
| --- | --- | --- | --- | --- |
| Título de página | Display | 28/34 desktop; 24/30 mobile | 700 / -0,02em | Pedidos |
| Título de seção | Display | 20/26 | 600 / -0,01em | Salão |
| Título de card | Display ou corpo | 16/22 | 600 / normal | Pedido #24 |
| Corpo e campos | Inter | 16/24 | 400–500 / normal | Endereço e instruções |
| Texto compacto | Inter | 14/20 | 400–600 / normal | Operador, horário, ações |
| Metadado | Inter | 12/16 | 400–600 / normal | Tempo e informação auxiliar |
| Valor/identificador | Inter ou display | 16/22 ou 20/26 | 600–700 / normal | R$ 112,00; mesa 07 |

Números comparáveis usam `font-variant-numeric: tabular-nums`; alinhar valores à direita em tabelas e manter moeda e sinal junto ao valor. Em cards, usar alinhamento consistente com a leitura e nunca confundir total da mesa com fatia do pedido. Mobile não deve reduzir corpo apenas para caber; quebrar linhas, reorganizar ou ocultar somente informação secundária recuperável. Preserve controles de aumento de fonte e teste conteúdo longo. Legado contém tamanhos e pesos fora da escala; migração é incremental e não deve mudar números operacionais.

## Cor, contraste e estados

**Existente:** fonte de verdade dos valores claros/escuros, ação, foco e perfis é [`komaFoundation.css`](../../src/styles/komaFoundation.css); estados gerais adicionais estão em [`src/index.css`](../../src/index.css). Referência da marca `#05c49d` não é automaticamente a cor de todo botão. Para ação principal use `--koma-action-bg` com `--koma-action-text`, hover e foco correspondentes ao tema; compra usa seus próprios tokens. Ação secundária é neutra e distinguível, sem competir com a principal. Perigo exige rótulo e confirmação proporcional à consequência.

Exemplos calculados para cores sólidas, sem transparência: texto `#071c17` sobre `#05c49d` **7,91:1**; branco sobre `#00745f` **5,73:1**; `#b5c3bf` sobre `#192d24` **7,99:1**. Não extrapolar para hover, gradiente ou camadas translúcidas sem medir a composição real. Meta [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/): texto normal ≥4,5:1; texto grande ≥3:1; componentes e indicadores de estado necessários ≥3:1 contra cores adjacentes. Foco visível e não encoberto; testar teclado. Alvo mínimo 24×24 CSS px ou exceção aplicável; preferir ≥44×44 em ações touch críticas. Estados devem incluir texto ou símbolo além de cor. Não padronizar o significado de uma cor entre contextos: cores de mesas do Garçom são exceção operacional preservada.

## Hierarquia, espaço e profundidade

**Direção:** título e dado que identificam o trabalho primeiro; ação principal junto ao conteúdo que ela afeta. Dado financeiro crítico e erros devem ser explícitos; não repetir contagens já visíveis nem criar badges ou ilustrações sem função. Agrupar por proximidade, não por caixas aninhadas. Tabelas e listas preservam contexto e unidades.

Usar base de 4 px: 4–8 dentro de controles, 12–16 entre elementos relacionados, 16–24 entre cards e 24–32 entre seções, ajustando densidade e espaço disponível. Esses intervalos são direção, não tokens de geometria universal já implementados; em grades existentes preservar o comportamento validado. No Caixa, separar fundo, coluna e card por superfície/borda suave; elevar apenas camadas interativas, popovers e diálogos. Usar raio coerente com o componente, sem atribuir o mesmo raio a tudo. Sombra discreta comunica camada, não decoração. Gradiente de ação de compra é exceção existente; blur, transparência e brilho não devem prejudicar leitura nem aparecer por padrão. Transições curtas devem explicar mudança de estado, respeitar `prefers-reduced-motion` e permitir resposta imediata em dispositivos limitados.

## Componentes e padrões

Consultar [inventário e contratos](COMPONENTES.md) antes de criar. Reutilizar quando função, interação, acessibilidade e dados coincidirem; especializar composição e comportamento quando diferirem. Uma aparência semelhante não autoriza unir estado financeiro, ações ou projeções. Modais precisam de nome, foco inicial e contido quando modal, Escape quando seguro e retorno ao gatilho; avisos devem dizer o que ocorreu e o que fazer. Não inventar sucesso, usar skeleton apenas enquanto carrega e diferenciar falha, vazio e dados antigos.

## Assets

Consultar [catálogo](ASSETS.md) e [proveniência](../../ASSET_PROVENANCE.md). Asset é opção, não obrigação; usar logomarca correta ao fundo, evitar ilustração atrás de informação, marcar decorativos com `alt=""`. Não incorporar fotos de clientes ou marcas de terceiros sem direitos. Status informado como oficial não substitui evidência de cessão. SVG local simples serve a marcas e ícones; para fotografia, escolher formato responsivo e dimensões adequadas, preservando qualidade e procedência. Não duplicar assets de produção na biblioteca.

## Acessibilidade, performance e responsividade

A tela deve funcionar com teclado, nomes acessíveis, foco visível e erros associados a campos. Em layout pequeno, preservar tarefa, informação e áreas seguras; avaliar zoom, texto ampliado, teclado virtual e barras fixas. Não assumir que uma captura comprova acessibilidade.

Compartilhar a leitura no responsável existente por recurso e tenant; invalidar após mudança autoritativa, coalescer eventos e cancelar/listeners ao desmontar. WebSocket/SSE e reconciliação são complementares: preservar recuperação de rede, intervalo e frescor necessários. Reduzir trabalho em abas ocultas quando seguro; não reduzir verificação de pagamento ou entrega sem comprovar contrato. Usar lazy loading de rotas e imagens fora da tela, reservar dimensão, priorizar seletivamente imagem crítica e evitar dependências pesadas sem medir. Não apresentar economia estimada como medida. Mais detalhes em [economia e continuidade](PERFORMANCE.md), [baseline](BASELINE.md) e [comparação visual](VISUAL-2026-11-02.md).

## Anti-ruído e evolução

Evitar cartões dentro de cartões, chamadas genéricas, gradientes, ícones, números e animações apenas decorativos. Um título descreve a tarefa; uma ação diz o que faz; um estado informa o fato e o próximo passo. Testar novos componentes nas condições reais de uso antes de chamá-los globais. Documentar divergência justificada, origem dos assets, versão e evidência; preservar exceções aprovadas e registrar pendências em vez de fingir uniformidade.
