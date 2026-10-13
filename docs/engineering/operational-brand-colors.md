# Hierarquia de cor operacional

A referência fornecida é o logo/wordmark Kôma: verde-menta e branco/preto. O SVG animado contém o verde #05C49D; a interface usa esse verde como acento no tema escuro, sem carregar animação, filtros ou assets adicionais durante a operação.

A ação principal usa preenchimento sólido e texto contrastante. Seleção de aba, estado positivo e ações nos cards usam uma superfície suave da mesma família. Reimpressão no detalhe usa superfície neutra, preservando o atalho externo de um clique. Título e número são a primeira referência; metadados continuam legíveis, com menor ênfase.

Origem e modalidade de pedidos deixam de introduzir roxo, ciano e amarelo decorativos. Ícones e rótulos preservam a distinção entre online, caixa, garçom, maquininha, entrega e retirada. Vermelho e âmbar continuam identificando situações de erro, cancelamento, atraso e atenção; nenhuma condição de estado é alterada.

No tema claro, os tons de verde para texto e botão são mais escuros que o logo para manter contraste. Os tokens de ação, texto, superfície suave e borda são separados: usar uma única cor literal em todos os fundos prejudica leitura. O foco de teclado permanece visível.

Escopo desta etapa: tokens globais de marca/foco, navegação horizontal compartilhada, cards operacionais e detalhe compartilhado. Não há substituição indiscriminada de classes de cor de telas fiscais, gráficos, pagamentos ou cardápios personalizados pelos restaurantes. Esses consumidores devem ser migrados em etapas, distinguindo decoração e significado.

Validação local mede contraste de texto >=4,5:1 com composição real de transparências, estados normal/hover, temas claro/escuro e texto padrão/gigante. A matriz operacional cobre fontes sem overflow e fluxos existentes com mocks locais. Nenhuma escrita na loja real, mudança de API/polling ou novo custo de infraestrutura. Reversão por revert da PR.
