# Tablet grafite aprovado — tela separada e PNG transparente

## Entrega

- Moldura: `src/assets/koma-tablet-graphite-shell-v2.png` (1230 × 900 px, RGBA, aproximadamente 237 KiB).
- Fundo externo **e visor** têm alpha real; a textura metálica permanece opaca. Não é apenas um recorte visual por CSS.
- O PNG conserva os detalhes do render gerado, sem ampliação artificial, com recorte do espaço externo sem uso.
- `EditableTabletFrame` posiciona HTML ou captura em uma camada separada, com perspectiva calculada para cada largura.
- `TabletFrame` fornece a demonstração atual. Usado na abertura e na aba Cozinha; notebook e celular continuam preservados.
- Arquivo do tablet anterior mantido em `src/assets/koma-tablet-shell-3d.png` e código anterior disponível no histórico Git.

## Trocar por prints reais

Na landing, importe uma captura local revisada e passe ao tour:

```tsx
<HowItWorks cozinhaScreenshot={{ src: cozinhaCapture, alt: 'Fila da cozinha do Kôma' }} />
```

Para uma instância individual:

```tsx
<TabletFrame screenshot={{ src: captura, alt: 'Tela real do Kôma' }} />
```

O padrão `contain` mantém a imagem inteira e sua proporção, com faixas escuras quando necessário. Um recorte intencional pode usar `fit: 'cover', position: 'top'`. O visor lógico mede 1280 × 900 px. Não usar capturas de navegador com outro dispositivo em volta. Revisar dados pessoais antes de publicar. No Hero, se substituir a sequência animada por uma captura fixa, ajustar também o texto do indicador para corresponder à tela escolhida.

## Origem e preparação

Render preparado pela ferramenta integrada de geração de imagens, em modo de edição, a partir da proposta de tablet aprovada pelo usuário. Prompt utilizado:

> Use case: precise-object-edit. Prepare this exact approved landscape tablet as a reusable website frame. Preserve its exact perspective, shape, scale, graphite metal body, thin bezels, tiny camera, right-hand thickness, edge reflections and full uncropped composition. Do NOT redesign it. Remove ALL screen content: KÔMA, Cozinha, subtitle, text, tickets, lines and buttons. The screen opening must be empty to accept live HTML or a screenshot. Remove the background completely, including floor, shadows and surrounding green halo. Output a genuine RGBA PNG cutout with alpha transparency outside the tablet AND inside the screen opening, leaving only the detailed physical tablet frame and camera. Transparency is real alpha, NOT a checkerboard painted in pixels, NOT a black or white background. Crisp antialiased metallic edges at high resolution, 1536x1024 canvas, same composition. No new markings, no new objects, no screen reflections obscuring the future interface.

A saída do gerador ainda veio RGB com quadriculado incorporado. A exportação de produção aplicou o recorte vetorial em `tabletFrameGeometry.json` ao canal alpha, sem repintar o aparelho. O original gerado foi preservado. A geometria também define o encaixe da tela, evitando duas calibrações divergentes.

Reexportação, com Sharp disponível localmente (não é dependência do site):

```sh
node scripts/export_tablet_shell.mjs render-original-1536x1024.png nova-moldura.png
```

`KOMA_IMAGE_TOOLS` pode indicar o módulo Sharp fornecido pelo ambiente. O script se recusa a sobrescrever a origem ou um destino existente e verifica fundo transparente, visor transparente e moldura opaca. Não usar o original RGB diretamente na landing.

## Verificação

- Testes unitários de PNG RGBA, dimensões, cantos, troca de conteúdo, ajuste de imagem e carregamento.
- `/tests/fixtures/device-preview.html`, somente no servidor de desenvolvimento: valida moldura sobre fundos claro/escuro/verde e alterna HTML e duas capturas com proporções diferentes. Não integra o build de produção.
- Ao alterar moldura ou enquadramento, revisar de 320 a 1440 px e verificar que a tela acompanha o aparelho sem overflow.

Padrão permanente solicitado pelo usuário: visual 3D aprovado, boa qualidade, fundo transparente e tela sempre substituível.
