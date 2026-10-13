# Identificação rápida no Kanban

O cabeçalho digital prioriza o nome do cliente. Retirada, Delivery e Consumo no local aparecem em uma etiqueta dentro do cabeçalho, junto de valor/impressora, com sacola, caminhão e talheres na identificação do pedido. Número persistido permanece em destaque separado. Nos pedidos de mesa, a identificação mostra Mesa + número, preservando o título do pedido e nomes configurados; origem continua no indicador secundário.

Cliente aparece no título e telefone/associação na segunda linha dos pedidos digitais, inclusive na finalização. Associação a mesa continua disponível sem substituir o número do pedido. Balcão/venda rápida permanece um caso explícito. Não são gerados novos números ou sufixos.

Em cards estreitos, preço e impressora ocupam uma linha própria, preservando área para os identificadores e rótulos. Título, cliente e indicadores quebram linha quando necessário; informações operacionais não desaparecem em reticências. A lista compacta de itens/complementos e a expansão existente permanecem, assim como a ação principal e a impressão direta.

São alterações de apresentação: seleção, cancelamento, baixa financeira, montagem de impressão, atualização em tempo real, filtros, SLA e número de requisições não mudam. R$112 em preparo + R$48 prontos continuam fatias distintas da mesma conta.

A validação usa pedidos simulados, com oito cards alternando retirada/delivery, nomes longos, números diferentes, dois temas e texto padrão/gigante, em celular/notebook. Confere modalidade e número em cada card, ausência de overflow, abertura do pedido certo e impressão em um clique. Regressões cobrem consumo local associado, conversão de modalidade, cozinhas/entregas/retiradas, composição de marmitas e as dez áreas com ampliação do texto. Nenhum pedido ou reimpressão de teste no restaurante real. Reversão por revert da PR.

A etiqueta está dentro do mesmo corpo pintado e clicável do card. Não há wrapper, faixa externa, espaço preto reservado ou movimento independente no hover. O espaço entre cards retorna ao intervalo normal da lista. Em cards estreitos, a identificação acompanha valor/impressora na linha flexível abaixo do nome; no desktop permanece à direita. Fonte e altura acompanham a preferência de tamanho do texto. Verde e superfícies suaves têm contraste de texto >=4,5:1 nos dois temas. A identificação de mesa e o título do pedido local permanecem na mesma hierarquia.

Para manter densidade, Mais recente participa da linha de indicadores de estado, sem reservar uma linha acima do cabeçalho. Modalidade é a primeira linha à direita no desktop; valor e impressora/recibo compartilham a segunda linha, em vez de uma pilha de três controles. O telefone, cliente, número, fonte ampliada e regras operacionais permanecem. A verificação geométrica confere valor/impressora na mesma linha e alinhamento entre modalidade/cliente no desktop, inclusive no card mais recente.
