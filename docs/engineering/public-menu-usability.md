# Clareza de montagem e sacola pública — 04/10/2026

Escopo autorizado: aplicar aprendizados de inspeção do KÔMA, BeeFood, Pingo Doce,
Tempero da Mama e Naza. Mudanças grandes na estrutura exigem direção do usuário.

## Implementado

- Instruções curtas por grupo, contador também em escolhas obrigatórias únicas e
  estado Completo após satisfazer o mínimo real.
- Seleção direta em grupos por tipos ou de uma única escolha; controles de
  quantidade mantidos em porções repetíveis e nos adicionais legados livres.
- Erro de composição leva ao primeiro grupo inválido sem apagar escolhas.
- Quantidade de marmitas/itens, quantidade no botão e aviso de unidades com a mesma
  montagem. Nome, quantidade e total permanecem no nome acessível da ação.
- Sacola permite editar montagem no modal canônico. Cancelar não modifica o item;
  salvar substitui o item e soma quantidades se a mesma assinatura já existir.
  O drawer continua montado, preservando contato, endereço e pagamento.
- Opções indisponíveis são removidas da edição com aviso para conferir a montagem.
- Sacola e revisão reutilizam OrderItemComposition por um adaptador de rascunho.
  Marmitaria agrupa pelas identidades canônicas de grupo; outros perfis continuam
  com complementos. Observações livres continuam separadas e intactas.
- Ação do cartão Marmitaria diz Montar quentinha. Pagamento não anuncia cartão
  ausente: explica o momento de pagamento das opções presenciais habilitadas.

## Preservado / pendente

Não altera mínimos, máximos, modo de seleção, catálogo, preços, configuração
bancária, contratos de envio ou dados de restaurantes. Os grupos opcionais da G
são intencionais segundo o contrato; não se transformam em obrigatórios.
P/M/G continuam produtos distintos. Não adiciona consultas por clique.

Direção escolhida pelo usuário: manter a tela atual e revelar seções progressivamente.
Itens → recebimento → pagamento → contato, com atalhos para voltar e cupom opcional.
Campos permanecem montados e a validação abre a seção com pendência.
Navegação móvel já existe em main e foi reaproveitada. O relato de uma P aparecer
em pedido de três G não foi reproduzido e não é declarado corrigido por esta PR.

## Verificação

TypeScript, 936 testes unitários, build de produção e 43 testes de navegador em
390 px e desktop 1366 px. Testes usam API simulada e não enviam pedidos reais.
Cobrem regras por tipos/porções, entrada canônica, edição/cancelamento, quantidade,
total e preservação de contato. Mudança restrita ao frontend: não altera backend.

Cinco casos não se aplicam aos viewports selecionados: toque exclusivo de celular e CEP exclusivo de desktop 1024. Os fluxos de CEP não foram revalidados nesta execução.
