# Notebook grafite aprovado — tela independente

## Integração

- Moldura aprovada: `src/assets/koma-notebook-graphite-shell-v2.png`, 1536 × 1024 px, RGBA. O mesmo arquivo da prévia, sem redesenho ou ampliação.
- Alpha real no fundo e no visor. Corpo, teclado, câmera e trackpad permanecem na moldura; a interface fica em uma camada separada.
- `LaptopFrame` substitui o dispositivo plano somente na aba **Pedidos** do tour. Tablet, celular, textos, planos e fluxo operacional não foram alterados.
- O dispositivo antigo foi preservado em `FrontalLaptopFrame.tsx` para referência, mas não é mais usado no tour.
- `laptopFrameGeometry.json` registra dimensões e encaixe do visor, com uma pequena margem sob a borda. A altura lógica deriva da proporção do visor para não deformar capturas.
- O canvas absoluto escala com a moldura via `ResizeObserver`, sem impor sua largura lógica ao layout. A moldura reserva a proporção antes do carregamento e carrega sob demanda.

## Capturas futuras

```tsx
<HowItWorks pedidosScreenshot={{ src: capturaPedidos, alt: 'Pedidos no Kôma' }} />

// Ou uma instância independente:
<LaptopFrame screenshot={{ src: capturaPedidos, alt: 'Pedidos no Kôma' }} />
```

Sem captura, a demonstração HTML continua funcionando. Com captura, ela substitui a demonstração. `contain` preserva a imagem inteira, com faixas escuras quando necessário. Apenas um recorte deliberado deve usar `fit: 'cover'` e `position`. Preferir capturas horizontais próximas de 1013:620, sem moldura de navegador, e revisar dados pessoais antes de publicar.

## Origem e preparação da prévia

Render de aparência 3D gerado pela ferramenta integrada de imagens, não geometria GLB/OBJ interativa. A versão aprovada já tinha sido exportada com alpha vetorial real, pois o gerador havia desenhado um quadriculado RGB. Esta integração copia esse PNG final sem modificar seus pixels.

Render original preservado: `exec-c47a8fde-06d9-48c5-86c3-dbbf1cd2216a.png`, pasta de imagens geradas da conversa `01a04990-bf43-7f10-8cee-1b3d6f82886b`.

Prompt final da geração/edição:

> Edit only transparency of this existing laptop asset. Preserve the exact laptop geometry, position, full keyboard, trackpad, all graphite metal surfaces, hinges, bezel and camera. Remove the entire outer black background and glow, replacing with genuine transparent alpha. Also remove only the INNER rectangular black screen surface, replacing with genuine transparent alpha, leaving the bezel and webcam fully intact. The goal is a reusable product shell PNG: no background pixels and no display pixels, just the physical hardware. The interior screen hole must have gently rounded corners and clean antialiased edges. DO NOT draw a checkerboard or replace black with gray; set alpha to zero outside the object and inside the screen. No other changes. Keep original resolution and sharpness. Output isolated RGBA cutout suitable for overlaying a separately editable screen.

## Verificação

- `tests/editableLaptop.test.ts`: dimensões/RGBA, conteúdo independente, captura substituível, ajuste proporcional e preservação dos demais aparelhos.
- `/tests/fixtures/device-preview.html`: selecionar **Notebook**, alternar fundos claro/escuro/verde e modos Moldura/Interface/Captura A/Captura B. Fixture exclusiva do servidor de desenvolvimento, fora do build de produção.
- Conferir o tour de 320 a 1440 px, sem rolagem horizontal nem corte da moldura, inclusive ao alternar abas.
