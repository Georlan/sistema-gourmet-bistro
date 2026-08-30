# Celular grafite com tela substituível

Apenas a moldura é uma imagem. A tela é uma camada independente: hoje contém
`ProductScreen`; depois pode receber uma captura real sem gerar outro celular.
O tablet, o notebook e os arquivos dos modelos anteriores foram preservados.

## Trocar pela captura real

Importe a captura local e passe-a para o tour em `LandingPage.tsx`:

```tsx
import cardapioCapture from '../assets/cardapio-real.webp';

<HowItWorks cardapioScreenshot={{
  src: cardapioCapture,
  alt: 'Cardápio do Kôma: categorias, produtos e resumo do pedido',
}} />
```

O padrão é `contain`: mostra a imagem inteira, sem distorção, com faixas escuras
se a proporção diferir. Para um recorte intencional, use `fit: 'cover'` e
`position: 'top'`. Prefira uma captura da tela do app sem navegador ou moldura;
capturas muito longas devem ser recortadas editorialmente antes da inclusão.
O visor lógico tem 430 × 990 px. A câmera ocupa uma pequena área superior.

Sem `cardapioScreenshot`, volta a aparecer a demonstração em HTML. Nenhum dado
de clientes é incluído automaticamente. Antes de publicar futuras capturas,
remova telefones, endereços e outras informações reais de clientes.

## Moldura e encaixe

- Imagem: `src/assets/koma-phone-graphite-shell-v2.png`.
- Componente: `src/landing/product/EditablePhoneFrame.tsx`.
- Estilo: `src/landing/product/editable-phone.css`.
- Uma máscara SVG recorta fundo e visor; o quadriculado do arquivo gerado não
  aparece na página. A perspectiva é calculada pelo hook existente para que
  tela e moldura mudem de tamanho juntas, sem largura mínima imposta pela tela.
- O modelo é um mockup 3D renderizado com conteúdo substituível, não GLB/OBJ.

Moldura preparada pela ferramenta integrada de imagens, a partir do conceito
aprovado. Prompt de edição: preservar corpo grafite, ângulo, proporções, câmera,
botões e reflexos verdes; remover todo o conteúdo do visor e o fundo para
permitir sobreposição independente da interface real. Como a saída trouxe
quadriculado incorporado, o isolamento final é feito pela máscara do componente.
