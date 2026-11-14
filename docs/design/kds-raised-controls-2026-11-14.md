# KÔMA — Controles elevados da Cozinha (14/11/2026)

## Problema observado
A captura real após PR #1322 mostrou que a Cozinha ainda destoava do Caixa: filtros planos com sublinhado, botão Concluir genérico e confirmação individual sem o relevo do próprio sistema. O usuário apontou especificamente o segmento ativo Salão e a ação Novos pedidos como referências reais.

## Código de referência
- CSS real de **Salão**: src/components/caixa/orders/cashierOrderColumns.css, classes orders-mobile-stages e orders-mobile-stages__button (incluindo contagem interna, borda clara, brilho superior e sombra inferior curta).
- CSS de **Novos pedidos**: src/components/caixa/orders/cashierOrderControls.css, classe orders-new-orders (relevo tonal por borda/glint/sombra e pressionamento).
- Design system: docs/design-system/DESIGN_SYSTEM.md, com Inter/Space Grotesk, contraste acessível, poucos destaques, superfície em vez de glow e regras de tema.
- Correção anterior: docs/design/kds-quiet-hierarchy-2026-11-14.md, que continua válida: sem amarelo de preparo, chip vermelho de tempo ou ícones decorativos.

## Refatoração
1. **Filtros**: voltar a ser um controle segmentado com base elevada, seleção menta, borda e pequeno contador interno; preservados estados e ações pré-existentes.
2. **Concluir N**: CTA de lote com linguagem do segmento ativo Salão, número destacado em contador embutido; preservado aria-label e a chamada única de confirmação de lote. A marca concentra a atenção nesta ação.
3. **Pronto**: botão por item tonal com brilho superior sutil e sombra inferior curta, inspirado em Novos pedidos. Um único check, sem iconografia de efeito, sem segunda ação colorida.
4. **Ticket**: corpo contínuo, identidade com tonalidade elevada, linhas finas, produtos com contraste e composição legível, sem cartões dentro do ticket.
5. **Tema**: dark utiliza a menta já presente no botão Salão (#83e3c6) e light utiliza verde operacional (#00745f); não misturar animação de fundo com troca instantânea de texto para evitar contraste temporariamente inferior a WCAG.
6. **Pressão**: translação de 2px e remoção temporária da sombra inferior em clique; hover só quando dispositivo suporta, desligar transições em reduced-motion.
7. **Escopo**: CSS/estrutura visual do KDS e testes/documentação; nenhum domínio, backend, alteração de estado, pagamento, impressão, entrega ou banco. Rollback revert sem migração.

## Verificações esperadas
- Testes unitários, lint e build.
- Browser Playwright Chrome mobile e desktop + Firefox: fila, ações individuais/lote, falhas de backend, modo foco e temas.
- Contraste de fundo/texto efetivo >=4,5:1 em filtro selecionado, ação principal e secundária em dark e light, inclusive imediatamente após troca de tema.
- Sombras efetivas para comunicar profundidade; alvos >=44px e nenhuma rolagem horizontal em 320/360/390/430px; preferências de texto grande/gigante.
- Nenhuma escrita de produção durante os testes, e publicação por PR/gates verdes com verificação /meta.json.

## Resultado implementado e auditado
- CSS de apresentação do KDS reescrito integralmente para toolbar, filtros, menus, busca, tickets, itens, botões e estados de interação. Regras existentes de modo foco, movimento reduzido e projeções foram preservadas.
- Validação final: lint, 1.259/1.259 unitários, build, Chromium mobile-390/desktop-1366 (16/16), Firefox-390 (6/6).
- Capturas Playwright em 320 dark, 390 dark e 430 light: segmentado com contador integrado, botão primário elevado e secundário elevado, sem overflow. Contraste efetivo >=4,5:1 no filtro ativo e nos dois botões durante mudança imediata de tema.
- Correção adicional: remover transição de cor de fundo na ação de lote durante mudança de tema, pois texto imediato sobre fundo animado cria instante de contraste insuficiente.
- Peso compilado (mesma árvore de dependências): CSS principal anterior 58.571 B gzip-9 (8afe79fd) versus novo 58.961 B gzip-9 (+390 B). JS CaixaPanel permanece aproximadamente 136,7 KB gzip; nenhuma dependência ou import novo.
- Nenhum acesso mutável ao backend de produção, nenhum pedido sintético e nenhum pagamento real.

## Contrato de publicação
Merge por PR somente com checks obrigatórios verdes no SHA da branch. Confirmar deploy Cloudflare Pages, correspondência de SHA em /meta.json no domínio de produção e smoke GET/browser readonly. Reverter por PR se houver regressão (nenhuma migração).
