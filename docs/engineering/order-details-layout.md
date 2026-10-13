# Detalhe operacional do pedido

O detalhe compartilhado em `KanbanOrderDetails` prioriza itens, composição e observações já registradas. Cliente, telefone, loja, número e horário aparecem uma vez; pagamento no atendimento usa a superfície neutra, preservando o estado financeiro original.

A identidade e a ação principal ficam fora da área rolável. O corpo acomoda pedidos maiores sem esconder o botão de avançar. Reimpressão, conversão, associação, transferência e cancelamento ficam em “Mais opções”; o botão externo da impressora permanece diretamente acessível, com os mesmos IDs e permissões. Entregador obrigatório continua na ação de despacho.

A observação é editada junto ao item, mediante expansão. Agrupar a apresentação não agrupa a gravação: cada unidade mantém seu ID técnico e editor próprio. Uma falha de gravação conserva o texto digitado. Itens pagos ou fora de preparo não ganham editor.

Uma atualização não pode promover uma fatia explícita `projectionScope: launch` para a mesa inteira. O cancelamento dessa fatia vinculada à mesa utiliza os IDs dos itens do pedido, mesmo quando a modalidade é consumo no local. O contexto agregado de mesa e as projeções antigas sem escopo preservam seu comportamento.

## Validação e limites

Fixtures locais cobrem 390/1366 px, texto padrão/gigante e temas claro/escuro, contraste, observação por unidade e falha, ação principal, reimpressão externa, transferência, cancelamento isolado, conversão, entrega e SmartPOS. Pedidos longos continuam podendo exigir rolagem no corpo; a compactação não omite composição necessária.

Quatro testes legados de pagamento falhavam também no main de referência 6171a228: pressupunham Pix e seleção de itens automáticos. Os testes agora selecionam explicitamente Pix e o item pronto antes de verificar a mesma baixa de R$48 e a idempotência. A fixture operacional também passa a fornecer os direitos de impressão que os testes pretendem exercer. Nenhuma regra financeira foi alterada para satisfazer esses testes.

Não há mudança de API, persistência, polling, Core de Impressão ou configuração da loja. Produção é validada somente por leitura. Testes de impressão simulam solicitação, não comprovam papel físico. Reversão: revert da PR no frontend.
