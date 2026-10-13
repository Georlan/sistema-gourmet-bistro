# Identificação rápida no Kanban

O cabeçalho passa a distinguir modalidade antes da origem. Retirada, Delivery e Consumo no local aparecem no título, com sacola, caminhão e talheres. Número persistido permanece em destaque separado. Nos pedidos de mesa, a identificação mostra Mesa + número, preservando o título do pedido e nomes configurados; origem continua no indicador secundário.

Cliente e telefone ficam na segunda linha dos pedidos digitais, inclusive na finalização. Associação a mesa continua disponível sem substituir o número do pedido. Balcão/venda rápida permanece um caso explícito. Não são gerados novos números ou sufixos.

Em cards estreitos, preço e impressora ocupam uma linha própria, preservando área para os identificadores e rótulos. Título, cliente e indicadores quebram linha quando necessário; informações operacionais não desaparecem em reticências. A lista compacta de itens/complementos e a expansão existente permanecem, assim como a ação principal e a impressão direta.

São alterações de apresentação: seleção, cancelamento, baixa financeira, montagem de impressão, atualização em tempo real, filtros, SLA e número de requisições não mudam. R$112 em preparo + R$48 prontos continuam fatias distintas da mesma conta.

A validação usa pedidos simulados, com oito cards alternando retirada/delivery, nomes longos, números diferentes, dois temas e texto padrão/gigante, em celular/notebook. Confere modalidade e número em cada card, ausência de overflow, abertura do pedido certo e impressão em um clique. Regressões cobrem consumo local associado, conversão de modalidade, cozinhas/entregas/retiradas, composição de marmitas e as dez áreas com ampliação do texto. Nenhum pedido ou reimpressão de teste no restaurante real. Reversão por revert da PR.
