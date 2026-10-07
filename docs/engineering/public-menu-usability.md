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
- Textos de quantidade e cartões permanecem gerais: o perfil Marmitaria inclui
  também bebidas e sobremesas. Pagamento não anuncia cartão
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

TypeScript, 937 testes unitários, build de produção e 53 testes de navegador em
390 px e desktop 1366 px. Testes usam API simulada e não enviam pedidos reais.
Cobrem regras por tipos/porções, entrada canônica, edição/cancelamento, quantidade,
total e preservação de contato. Mudança restrita ao frontend: não altera backend.

Cinco casos não se aplicam aos viewports selecionados: toque exclusivo de celular e CEP exclusivo de desktop 1024. Os fluxos de CEP não foram revalidados nesta execução.

## Integração e cadastro

Preserva os trabalhos já integrados de mínimo zero/adicionais (#960, #966, #988),
retomada do pedido (#992) e remoção de endereço antigo de visitante (#996).
Atualizado com main após #998. P e G recebem o mesmo grupo opcional de adicionais
na leitura pública atual; a ausência anterior da P era no vínculo do cadastro.
Nenhuma regra de composição é injetada no frontend. Acesso direto à composição
no caixa abre a configuração salva sem exigir gravação dos dados básicos.


## Segunda entrega — fluidez do pedido

Escopo aprovado em 04/10: corrigir gaps observados, aplicar os seis pontos da
revisão do guia, testar em paralelo e integrar após checks verdes.

- Recebimento e pagamento validam antes de Continuar. Títulos/atalhos permitem
  voltar livremente; a revisão final conserva a validação completa. O campo de
  endereço pendente recebe foco. Troco vazio, inválido ou abaixo do total não avança.
- Produtos com montagem usam foto compacta. Somente grupos min=0 inteiramente
  pagos podem recolher; cabeçalho conserva quantidade e acréscimo por unidade.
  Grupos mistos e obrigatórios permanecem expandidos. Escolhas e total não se apagam.
- Marmitaria mostra resumo das escolhas obrigatórias reais do produto. Não infere
  peso, volume ou nomes P/G nem troca produtos/tamanhos automaticamente.
- Montar outra diferente inicia uma nova composição de uma unidade; a linha
  anterior e os campos da sacola ficam preservados. Composições iguais continuam
  somadas pela assinatura canônica já existente.
- Contato explica a finalidade do celular e remove termos internos. Reconhecimento
  mantém proteção de dados e não expõe nome/endereço de cadastro por telefone.
- Acompanhamento: testes preservam retomada após fechar aba, recusas, conversa e
  isolamento entre restaurantes. Não cria novas consultas/subscriptions de rastreio.

Observação em produção antes da correção: restaurante 6 aberto, P de R$7 com
composição válida avançava a pagamento com endereço vazio e abaixo do mínimo R$10;
a revisão final bloqueava o pedido. Nenhum pedido ou mensagem real foi enviado.

Os novos cenários detectaram perda do endereço ao fechar a revisão. A sacola agora
permanece montada, mas oculta, enquanto há itens; o rascunho é mantido somente em
memória, reiniciado por restaurante e descartado quando o pedido esvazia a sacola.
Não reintroduz persistência de endereço de visitante removida em #996.

Trocar cupom externo limpa o desconto aplicado anterior; a impressão de validação
inclui o código normalizado para descartar respostas atrasadas de outro cupom.
O total continua vindo das mesmas regras e os descontos são revalidados no envio.
