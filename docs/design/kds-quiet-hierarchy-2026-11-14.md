# KÔMA — Cozinha sem semáforo decorativo (14/11/2026)

## Evidência de campo
A captura mobile pós PR #1321 mostrou a superfície em dark operando, mas uma sucessão de sinais artificiais: trilho lateral amarelo, pontos amarelos antes de cada item, relógio vermelho em badge, check circular dentro de um botão verde, e botão de lote muito parecido com ações individuais. Mesmo após melhora das fontes, esses adornos geraram ruído visual e estética genérica.

## Referências já presentes no repositório
- Design system: marca não é a cor de todo botão, prioridade de informação, token semântico, evitar boxes/ícones gratuitos e profundidade por superfície/borda, não efeitos falsos.
- Direção tonal do PDV: ação primária menta, secundária neutra/tonal, contraste de texto e valor; nada de glow/gradiente sem função.
- Estilo do Salão: fundo da identidade levemente elevado sobre card, borda fina e tipografia com conteúdo real.
- Direção do Caixa: estado e tempo com menta/azul e peso tipográfico, não amarelo/vermelho genéricos; evitar adornos extras.

## Decisão visual revisada
1. **Apenas o conteúdo determina a hierarquia**: Space Grotesk no número do pedido; Inter nos produtos, detalhamento, temporizador e ações. Peso 700 para identidade, 600 para produto/ação, 400–500 para informações auxiliares; contrastes definidos pela paleta operacional do KÔMA.
2. **Sem amarelo para em preparo**: não há trilho colorido, bullets de status ou bordas de observação amarelas. “3 pendentes” já informa o estado. Tickets prontos permanecem identificados por texto sem nova faixa cromática.
3. **Tempo sem falsa urgência**: o tempo decorre desde o lançamento, não é SLA nem alerta de erro. Nos patamares existentes de 10/15 minutos só cresce a ênfase tipográfica; não vira chip vermelho.
4. **Profundidade funcional**: o cabeçalho recebe tratamento tonal suave mesclando os tokens --koma-operation-raised e --koma-operation-surface; a lista permanece na superfície neutra. Nada de glow, card dentro de card ou sombra decorativa.
5. **CTA de lote**: única ação com cor da marca, usando --koma-action-bg/text conforme tema, altura touch de 44px, canto menos inflado e pressão sutil apenas na interação.
6. **Botão individual**: neutro, borda do repertório tonal do PDV (#5b7a69), cor legível e ícone Check único, sem círculo artificial; ações do item preservadas.
7. **Escopo**: somente TSX/CSS do KDS, documentação e E2E visual. Sem alteração nos callbacks, timers, status, lote atômico, dados, backend, banco ou fluxo de pagamentos/entrega.

## Teste
Capturas fictícias nos dois temas (320 a 430px), texto grande/gigante e desktop; verificar contraste, ausência de overflow, alvos ≥44px, retorno de erro, confirmação individual/lote, estado pronto e ausência de adornos proibidos. Deploy por PR com gates verdes e validação do SHA em produção. Nenhuma transação real.

## Evidências de implementação na branch
- Lint e build Vite: aprovados.
- 1.259 testes unitários aprovados.
- Playwright Chromium: 16/16 casos focais, mobile e desktop (incluindo modo foco, erros de confirmação, lote atômico e tempo).
- Playwright Firefox: 6/6 casos focais.
- Teste visual atualizado verifica ausência do trilho cromático, dos indicadores antes de itens e do chip de tempo; contraste de ações ≥4,5:1, alvos ≥44px e sem overflow em 320/360/390/430px, inclusive texto grande/gigante.
- CSS principal compilado do PR #1321: 58.793 B gzip. CSS principal desta revisão: 58.571 B gzip (redução de 222 B). JavaScript CaixaPanel: 136.684 B gzip, sem novos imports. A comparação mede artefatos locais construídos com a mesma versão das dependências.
- Capturas de fixture avaliadas em modo claro e escuro; não houve pedido, pagamento nem mudança de estado de produção.
