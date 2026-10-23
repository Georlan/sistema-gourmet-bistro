# Substituição da apresentação do cardápio público — 23/10/2026

## Escopo e regra operacional

A apresentação artística passa a ser o padrão de `CardapioPage`. `?vitrine=editorial` mantém a apresentação anterior disponível para comparação e reversão. Produto, marmitaria, promoções, sacola, identificação, revisão, Pix e histórico continuam usando os componentes e contratos canônicos.

Decisão confirmada pelo usuário: entrega, retirada e consumo no local são modalidades independentes. O consumidor pode pedir antes de chegar; consumo no local não infere mesa a partir da URL. A associação operacional continua no Caixa.

## Falhas corrigidas

- Ranking artístico agora consulta a rota pública por restaurante, cancela resposta de escopo anterior e preserva o fallback de catálogo.
- Recomendações mantêm inclusão e ordem durante adição, remoção e chegada atrasada do ranking; não confundem ingrediente de um prato principal com acompanhamento nem usam itens desconhecidos como preenchimento.
- Hero e catálogo têm IDs distintos. Detalhes possuem botão de teclado independente da adição, com nome/preço acessíveis.
- Incrementos na sacola são aplicados ao estado atual, inclusive em eventos agrupados.
- Promoções usam a mesma expiração temporal nas duas apresentações.
- Busca reutiliza a normalização canônica, informa resultados vazios e permite limpar.
- Cabeçalho informa apenas modalidades habilitadas e o mínimo aplicável; botões têm 44 px. Ações de desktop respeitam os breakpoints e o foco é visível.
- Rolagem atualiza a categoria ativa na vitrine nova. O dock desaparece durante sobreposições.

## Evidência local

- TypeScript, 1.089 testes unitários e build aprovados.
- Matriz de jornadas antiga/nova: 148 aprovações e 10 skips por viewport. CEP foi executado separadamente no viewport previsto, com quatro aprovações. Os demais skips são toque mobile em desktop.
- Regressão adicional de composição, promoção, ranking atrasado, padrão/rollback e chat: 77 aprovações e um skip por viewport. Há sobreposição entre as matrizes; os totais não representam casos únicos.
- Backend: 57 testes focais aprovados de payload público, histórico, isolamento, ranking e WebSocket. Nenhuma mudança de código backend. A execução geral foi interrompida após 308 aprovações e um skip; não equivale à suíte backend completa.
- Capturas locais revisadas em 320/360/390/430/1366 px, dark/light. Ensaios de outros engines e estado do CI devem ser registrados na entrega/PR com o SHA final.
- Nenhum pedido, pagamento, impressão ou alteração de configuração em produção; restaurante 6 preservado. Escritas de navegador foram interceptadas por fixtures locais.

## Liberação e reversão

Revisar o diff e os checks no SHA final antes da autorização de merge. O checkout reaproveitado foi exercitado com respostas isoladas; não houve cobrança real de provedor. Capturas/emulação não certificam teclado físico/virtual e safe area em todo aparelho.

Após publicação autorizada, conferir o SHA servido do frontend e executar smoke não mutante. A API pode manter outra revisão por não haver mudanças backend. Em regressão, reverter o commit de substituição pelo fluxo de PR; o parâmetro editorial permite comparação imediata. Não apagar sacolas, pedidos, filas ou dados para reverter apresentação.
