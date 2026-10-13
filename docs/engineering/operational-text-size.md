# Tamanho do texto no operador

## Diagnóstico

A preferência antiga aplicava overrides apenas a text-xs/sm/base/lg/xl e alguns tamanhos arbitrários. As regras próprias de abas, cartões, filtros, tabelas e campos (incluindo !important) permaneciam fixas. A classe de escala também ficava no shell, sem alcançar os diálogos criados por portal no body. A preferência restaurada usava cast sem validação.

## Contrato

Padrão = 1; Grande = 1,2; Gigante = 1,4. A chave koma_font_size e o evento legado koma_font_size_changed são preservados. O helper valida valores, aceita eventos antigos e suporta seleção na sessão quando storage estiver indisponível.

O controller aplica --koma-text-scale no documento enquanto o operador está montado e restaura o valor anterior ao sair. Isso alcança o menu, todos os workspaces e os portais. Não é zoom: dimensões de imagens, QR, ícones e layout permanecem estáveis. Sem efeito na preferência de outros dispositivos ou na configuração da loja.

O processamento CSS escala tamanhos absolutos de font-size (px/rem e tokens Tailwind) e line-height absoluto uma única vez. Tamanhos herdados/em/percentual não recebem multiplicação extra. Sem o controller, o fallback é 1. Os overrides incompletos antigos foram removidos. Estilos inline de recuperação e eixos gráficos usam a mesma variável explicitamente. PostCSS já fazia parte do build; agora é declarado diretamente, na versão já instalada, sem pacote novo no runtime.

Abas mantêm sua seleção visível também ao mudar o tamanho dos textos, observando o tamanho dos filhos sem polling. A linha de preço/Adicionar dos produtos reorganiza-se em vez de apertar/prejudicar preço ou cortar palavras.

## Evidência

Typecheck, suíte unitária, build e preview de produção. Matriz: dez áreas, três tamanhos, 360/390/1366px; teste de proporção real via computedStyle, altura da aba e overflow da página. Controles reais da preferência, restauração em reload, Resumo e convite em portal, navegação e PDV com fixtures. Recuperação de venda simulada após 503/422/502 em Padrão e Gigante, no celular e notebook: sacola, destino, valor e chave de idempotência preservados. O seletor ambíguo dos dois atalhos de Novo pedido foi atualizado sem remover os atalhos nem relaxar os contratos. Nenhuma gravação no restaurante real; nenhum pedido, impressão, convite ou pagamento real.

Limite: a matriz cobre áreas e fluxos indicados, não todas as combinações possíveis de conteúdo do cliente. Texto impresso, imagens e canvas externos não são redimensionados pelo controle visual do operador.

Reversão: revert da PR restaura o mecanismo antigo; não há migração nem alteração de dados.
