# Direção visual incremental do Caixa KÔMA

- Inter para leitura, campos, controles e dados operacionais; Space Grotesk para títulos e identificação. Números usam alinhamento tabular. Monoespaçada fica restrita a código técnico.
- Estado, modalidade, origem e recência continuam visíveis, mas não precisam de caixas ou etiquetas em maiúsculas. Cor e símbolo complementam o texto, nunca o substituem. Exceções financeiras e erros merecem destaque próprio.
- Tema claro não deve usar branco puro como superfície dominante. Diferenciar fundo, coluna e card com tons claros suaves, mantendo contraste de texto de pelo menos 4,5:1. Não suavizar texto a ponto de prejudicar leitura.
- Tema escuro mantém superfícies distinguíveis; não usar preto quase absoluto em todo o espaço de trabalho.
- Preservar os caminhos atuais: corpo do card abre detalhes; ação e impressão não propagam o clique. Estados de produção, atendimento e pagamento continuam independentes. O valor de uma fatia não pode se apresentar como total da mesa inteira.
- Rótulos visuais não criam consultas ou estados próprios: usar as projeções existentes. Não alterar Garçom, Entregador ou Cardápio como efeito colateral do estilo do Caixa.

Implementação compartilhada: `src/components/caixa/navigation/cashierTypography.css`, `src/components/caixa/navigation/cashierChrome.css`, `src/components/caixa/orders/cashierOrderCards.css` e `src/components/caixa/orders/cashierOrderColumns.css`.

## Cards e troca de tema

- A modalidade fica no bloco numérico com asset próprio e rótulo acessível. Mesa é identificador do atendimento; `#número` continua sendo a identidade persistida do pedido. Não gerar números ou sufixos no frontend.
- Remover contagem genérica de itens do cabeçalho quando a lista já está visível. Manter informação de itens parcialmente prontos, pois ela descreve uma condição operacional.
- Recência é uma pequena faixa de borda. Somente o card mais recente dispensa contenção de pintura para permitir o desenho externo; os demais continuam contidos.
- Tema pode ser alternado pelo cabeçalho. Caixa e Entregador compartilham a transição nativa. Movimento reduzido, economia de dados, dispositivo limitado, API indisponível e listas longas usam troca imediata.

## Praticidade dos cards

- Tempo fica junto da identificação. O Salão não repete estado de preparo nem origem Garçom quando o responsável já está nomeado. Contexto financeiro, transferência e mesclagem continuam disponíveis.
- Modalidade volta ao bloco numérico, com asset e texto visível Retirada/Entrega. Apenas a logo oficial do parceiro ocupa a borda direita, sem duplicar a modalidade.
- Logos oficiais dependem de `source.channel` explícito. A lista atual do Caixa ainda precisa receber esse metadado canônico para todos os parceiros; a apresentação está preparada, sem inferir logo a partir do identificador do cliente e sem criar uma consulta por card.
- Destino de entrega vem antes dos itens. A atribuição mantém select nativo, guardas e ações existentes.
- Impressão tem estados visuais de hover, foco, pressão e indisponibilidade, com movimento reduzido respeitado.

## Interações do cabeçalho e detalhes

- Retirar o acionador de recolhimento do cabeçalho desktop. A borda da lateral e seu cabeçalho aceitam gesto horizontal; a borda também aceita ←/→ no teclado. Cliques em ações e rolagem vertical não recolhem o menu. Mobile conserva botão de acesso, permite abrir pela borda esquerda e fechar por gesto.
- Indicadores removido por decisão de produto; OperationalBanner mantém somente o heading acessível, sem registry, botão ou resumo. Conversas mantém o aviso de não lidas; Modo PDV mantém o contrato de tela cheia. Nenhum novo endpoint.
- Prévia sol/lua no hover usa apenas opacity/transform; movimento reduzido desliga transições. Troca de tema conserva o mecanismo compartilhado anterior.
- Detalhes de pedido usam Inter/Space Grotesk, horário formatado, foco inicial, ciclo de Tab só em controles visíveis, Escape, clique no fundo e retorno ao card. Ações de cancelamento, impressão, transferência e conversão continuam nos owners existentes.

## Detalhes: revisão de hierarquia e ações

- Mesa ganha título direto e asset vetorial próprio, sem repetir Cliente: Mesa. Retirada/entrega preservam cliente real, vínculo e ações existentes.
- Uma única superfície para ler os itens. Sem cartões internos por item nem etiquetas emolduradas para cada estado.
- Verde vivo identifica avanço operacional. Impressão usa superfície de papel com glyph térmico; Mais opções é disclosure; cancelar é ação textual neutra e continua abrindo confirmação.
- Assets originais e leves em public/brand/cashier/detail-{table,pickup,delivery,print}-v2.svg. Sem bibliotecas de animação, novas consultas ou imagens raster para controles.

## Pesquisa, aceite e lateral

- Arraste da lateral acompanha o ponteiro em tempo real: uma atualização de CSS por frame, estado React só ao soltar. Captura cancelada/unmount limpam a prévia. Ação por teclado e acesso mobile permanecem.
- Identificação Mesa é visível também na coluna mista. SLA conserva limites e tempo, com menta/azul e peso tipográfico em vez de amarelo/vermelho; produção parcial mantém aviso explícito.
- Faixa de controle prioriza busca, aceite automático e Novos pedidos. Removido apenas o total digital agregado da faixa; valores por pedido e indicadores seguem disponíveis. Glyph de caixa de entrada original em inbox-orders-v1.svg.
- Pausar/reabrir cardápio é neutro/menta; alta demanda usa azul. Falhas e confirmações destrutivas mantêm suas proteções. Sem mudar TTL, WebSocket, callbacks ou endpoints.

## Pausa, suporte e conversas

- Overlays partilham Inter/Space Grotesk e superfícies floresta/menta com tema claro suave, movimento curto na abertura e foco de teclado. Assets separados: pause-menu-v1.svg, support-note-v1.svg, chat-pair-v1.svg.
- Conversas mantém leitura, paginação, realtime, drafts e idempotência atuais. Prioridade continua explícita sem glow contínuo; atalhos curtos preenchem e focam a resposta, nunca enviam sozinhos. Falha da listagem é visível e não se apresenta como fila vazia.
- Suporte conserva sessão/tenant, tipo da mensagem, preservação do texto em falha e envio para o endpoint existente. A página de origem é informada sem alegar captura de tela.
- Pausa conserva motivo, duração, limites e reabertura autoritativa. Fecha por clique fora/Escape somente sem mutação pendente. Indicadores e registry de resumos foram removidos, preservando os headings acessíveis.


## Refinamento de interação e modalidades — 01/11

- Arraste mantém a largura interna enquanto recorta a lateral; o estado compacto é aplicado ao soltar. Cancelar o gesto remove a prévia. Não recalcular texto a cada movimento.
- Detalhes mostram endereço e ações disponíveis sem “Mais opções”. Cancelamento por lançamento continua separado de cancelamento da mesa; mesclagem exige confirmação e usa o endpoint existente.
- Sucessos aparecem discretamente no cabeçalho; erros continuam explícitos. Não cobrir os cards com notificações no canto inferior.
- Rodapé usa nome/logo existentes do restaurante; acesso à aparência existente. Não fazer upload na renderização. Uploads permanecem no CardapioAssetUploader/prepareImageUpload (logo limitada a 512px e validação no servidor).
- Retirada → Entrega e Entrega → Retirada continuam no fluxo de prévia autoritativa. Entrega → Entrega permite revisão do endereço e recálculo da taxa antes do despacho, com histórico do endereço original.
- Não liberar por simples remoção de guardas: conversões de contas de mesa, pedidos pagos/online, fiscais ou externos. Decisão aprovada: diferenças financeiras devem ficar pendentes para o Caixa, sem cobrança/estorno automático. Esse novo fluxo financeiro ainda precisa ser implementado e conciliado com a conta da mesa, o pagamento e integrações; não está habilitado nesta prévia.
- “Para viagem” foi esclarecido pelo usuário como Entrega no endereço; não criar uma quarta modalidade.
- Ambiente local de demonstração: tenant 99051; nenhum teste mutável no tenant 6. Não publicado.


## Detalhes compactos — mesa, retirada e entrega

Ver itens começa recolhido e usa os dados já carregados; abrir, editar e fechar não duplicam consultas. Ações principais primeiro, impressão em seguida, movimentação depois, cancelamento por último. Na mesa ficam somente Reimprimir Total (todos os lançamentos da mesa) e Conta Total (valores). Pedidos sem mesa usam reimpressão da comanda completa, não do primeiro lançamento. A via por lançamento continua disponível nos outros fluxos existentes, mas não é duplicada neste painel.

Grade visual de destinos usa a lista do Caixa, sem fetch adicional. Verde pontilhado/círculo indica livre; azul sólido/quadrado indica consumo. Nomes e status ficam acessíveis por rótulo; não repetir “em atendimento” em todas as opções. Confirmar é obrigatório após selecionar; mesclagem explicita destino e liberação da origem. Conflitos mantêm o painel aberto e exigem nova seleção. Escape fecha primeiro a escolha e devolve o foco ao comando de origem.

Assets vetoriais das ações ficam em CashierDetailActionArt; a seleção é CashierTableDestinations. Sem nova biblioteca, fontes remotas ou imagens bitmap. Todos os callbacks continuam nos owners existentes; não mudar cancelamento por pedido para cancelamento de toda a mesa.
