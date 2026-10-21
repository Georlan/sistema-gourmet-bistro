# Cardápio público — vitrine comercial e apresentação mobile

## Intenção e contratos

A vitrine permanece no início. O primeiro acesso da navegação retorna aos Destaques; quando o restaurante já possui essa categoria, o atalho se chama Início. Os mais escolhidos aparecem antes das campanhas editoriais. O ranking vem da API existente, mantém sua ordem e só resolve produtos atuais e disponíveis do mesmo catálogo. Sem histórico, não há rótulo de popularidade inventado.

O contrato atual agrega escolhas em 90 dias para pedidos aceitos/em produção/prontos/finalizados, excluindo itens cancelados. Não representa necessariamente vendas pagas, receita ou margem. A janela, elegibilidade, cache de 300 segundos e isolamento por restaurante não foram alterados. Categorias e redimensionamento não passam a consultar vendas.

## Apresentação

Capa real em proporção panorâmica; nenhuma grande capa vazia. Uma mensagem de fechamento mantém o motivo e a consulta disponível. Cabeçalho mede sua própria altura para que categorias e âncoras não fiquem escondidas. Nomes, preços e fotografias recebem prioridade; controles preservam os handlers e a montagem canônica. Sugestões horizontais mantêm a vitrine no início sem uma sequência vertical de grandes cartões.

## Referências e limites

- [Anota AI](https://anota.ai/blog/estrategias-para-delivery/): produtos populares e combos no início do cardápio.
- [Goomer](https://goomer.com.br/blog/cardapio-digital-ticket-medio): destaques e sugestão de acompanhamentos, extras e combos durante a compra. Números promocionais do fornecedor não foram adotados como resultado do KÔMA.
- [Ensaio randomizado de reposicionamento](https://doi.org/10.1186/s12966-023-01456-8): escolhas em plataforma experimental podem mudar com a posição. Seu objetivo era composição energética e os pedidos eram hipotéticos; não comprova aumento de ticket, conversão ou margem no KÔMA.

## Validação

Tipos, testes unitários e build. Browser: pedidos de visitante, endereço, bloqueio autoritativo, loja fechada, promoções compostas, fotos e recuperação de imagens, edição e quantidade da marmita, salada opcional e entradas canônicas do modal. Nova cobertura de ranking verifica ordem, exclusão de ID removido, navegação e ausência de novas consultas após os cliques. Cinco perfis cobrem tema claro/escuro, ausência de capa, busca sem resultado e recuperação, alinhamento da navegação e largura sem overflow.

Os contadores de consulta comparam antes/depois da interação; StrictMode executa duas montagens iniciais no desenvolvimento, o que não deve ser confundido com consulta disparada pela navegação.

Conferência manual com FastAPI e SQLite locais: navegação mobile, montagem a partir do destaque e bloqueio de inclusão com caixa fechado. A referência visual usa somente dados públicos copiados para tenant local 99120; nenhuma escrita foi feita no restaurante real 6. Produção será conferida por leitura das revisões servidas e do cardápio.

Reversão: reverter a PR. Não há migração, novos serviços, configuração persistente, preço, pagamento ou alteração de regras de montagem. O efeito sobre ticket médio depende de medição posterior; não é um resultado comprovado desta entrega.

Resultados locais: 282 cenários aprovados e 24 condicionais ignorados na matriz ampla; 108 aprovados na rodada final de montagem/navegação e cinco perfis, em nove larguras de 360 a 1920 px. O cenário novo de contagem de requisições foi corrigido para comparar com o baseline StrictMode e aprovado em todas as larguras.
