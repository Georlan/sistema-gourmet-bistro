# Referências de assets — inventário inicial

Estado: parcial. Arquivos permanecem nos caminhos de produção; não foram copiados. A presença aqui não autoriza uso automático nem comprova direitos. [ASSET_PROVENANCE.md](../../ASSET_PROVENANCE.md) é o registro de proveniência e liberação; a documentação ali exige evidências e aprovação humana para release comercial.

| Família | Local | Uso e limites | Proveniência / situação |
| --- | --- | --- | --- |
| Símbolo e wordmark | `src/assets/brand/koma-{symbol,wordmark}-on-{light,dark}.svg`; exports em `src/brand/komaBrand.ts` | Escolher variante conforme fundo e contraste. Preferir imports existentes. | Informados como oficiais; evidência de autoria e cessão/licença pendente no registro de proveniência. |
| Kit de marca | `src/assets/brand/koma/` | SVG e PNG de fundo transparente; consultar README da pasta. | Status jurídico deve ser conferido no registro de proveniência; não presumido por existir na pasta. |
| Ilustrações de Caixa | `public/brand/cashier/` | Ver README para modalidades, estado vazio e detalhe; decorativas não substituem rótulo. | README as descreve como originais; documentação jurídica ainda deve ser reconciliada com o registro central. |
| Formas | `public/brand/koma-wave-divider.svg`, `koma-hero-corner.svg`, `koma-organic-backplate.svg` | Recursos de composição; uso depende da função e contexto. | Autoria/licença não verificada nesta rodada. |
| Origem de parceiros | `src/assets/brand/delivery/` | Identificação de origem, não prova de integração; não redesenhar ou recolorir sem avaliar regras do titular. | Fontes e hashes em `sources.json` e README; direitos permanecem com titulares. |
| Arte e glifos do Entregador | `src/components/courier/CourierRideArtwork.tsx`, `CourierGlyph.tsx` | Componentes locais, dependentes do contexto. | Autoria/licença não verificada nesta rodada. |
| Fotos de clientes | conteúdo de cada restaurante | Usar apenas no contexto autorizado do tenant. | Não são assets oficiais do KÔMA. |

Faltam inventário de consumidores e arquivos legados, revisão de direitos, previews e verificação visual em temas claro e escuro. Consultar também `src/assets/brand/koma/README.md` e `public/brand/cashier/README.md`.

## Catálogo da pasta de marca e Caixa

O estado “referenciado” significa ocorrência literal no código; caminhos montados dinamicamente exigem revisão do componente. A ausência de referência literal não comprova desuso. Todos os direitos e aprovações seguem o registro de proveniência.

| Arquivo | Tipo | Referência no código | Situação de origem e contexto |
| --- | --- | --- | --- |
| [`cashier-counter-v1.svg`](../../public/brand/cashier/cashier-counter-v1.svg) | SVG | `src/components/CaixaPanel.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`chat-pair-v1.svg`](../../public/brand/cashier/chat-pair-v1.svg) | SVG | `src/components/caixa/chat/CashierConversationsDrawer.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`counter-v1.svg`](../../public/brand/cashier/counter-v1.svg) | SVG | `src/components/CaixaPanel.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`delivery-v1.svg`](../../public/brand/cashier/delivery-v1.svg) | SVG | `src/components/caixa/orders/CaixaOrdersWorkspace.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`detail-delivery-v2.svg`](../../public/brand/cashier/detail-delivery-v2.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`detail-pickup-v2.svg`](../../public/brand/cashier/detail-pickup-v2.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`detail-print-v2.svg`](../../public/brand/cashier/detail-print-v2.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`detail-table-v2.svg`](../../public/brand/cashier/detail-table-v2.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`dine-in-v1.svg`](../../public/brand/cashier/dine-in-v1.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`inbox-orders-v1.svg`](../../public/brand/cashier/inbox-orders-v1.svg) | SVG | `src/components/caixa/orders/CaixaOrdersWorkspace.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`operator-access-v1.svg`](../../public/brand/cashier/operator-access-v1.svg) | SVG | `src/components/caixa/navigation/CashierOperatorDrawer.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`order-ticket-v1.svg`](../../public/brand/cashier/order-ticket-v1.svg) | SVG | `src/components/caixa/orders/CaixaOrdersWorkspace.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`pause-menu-v1.svg`](../../public/brand/cashier/pause-menu-v1.svg) | SVG | `src/components/caixa/online-menu/OnlineOrderEmergencyControl.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`pickup-v1.svg`](../../public/brand/cashier/pickup-v1.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`salon-empty-v1.svg`](../../public/brand/cashier/salon-empty-v1.svg) | SVG | `src/components/caixa/orders/CaixaOrdersWorkspace.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`support-note-v1.svg`](../../public/brand/cashier/support-note-v1.svg) | SVG | `src/components/app/CustomerSupportWidget.tsx` | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`table-v1.svg`](../../public/brand/cashier/table-v1.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | README descreve como original; documentação jurídica não verificada. Uso operacional contextual. |
| [`koma-hero-corner.svg`](../../public/brand/koma-hero-corner.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Forma gráfica; procedência e uso atual requerem confirmação. |
| [`koma-organic-backplate.svg`](../../public/brand/koma-organic-backplate.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Forma gráfica; procedência e uso atual requerem confirmação. |
| [`koma-wave-divider.svg`](../../public/brand/koma-wave-divider.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Forma gráfica; procedência e uso atual requerem confirmação. |
| [`99food.png`](../../src/assets/brand/delivery/99food.png) | PNG | `src/components/MotoboyPwaPage.tsx`, `src/components/caixa/orders/CashierCardEdge.tsx` | Terceiro: fonte em `delivery/sources.json`; uso condicionado às regras do titular. |
| [`ifood.png`](../../src/assets/brand/delivery/ifood.png) | PNG | `src/components/MotoboyPwaPage.tsx`, `src/components/caixa/orders/CashierCardEdge.tsx` | Terceiro: fonte em `delivery/sources.json`; uso condicionado às regras do titular. |
| [`keeta.png`](../../src/assets/brand/delivery/keeta.png) | PNG | `src/components/MotoboyPwaPage.tsx`, `src/components/caixa/orders/CashierCardEdge.tsx` | Terceiro: fonte em `delivery/sources.json`; uso condicionado às regras do titular. |
| [`koma-logo-fundo-claro.png`](../../src/assets/brand/koma/koma-logo-fundo-claro.png) | PNG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Kit de marca; conferir direitos e aprovação no registro central. |
| [`koma-logo-fundo-claro.svg`](../../src/assets/brand/koma/koma-logo-fundo-claro.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Kit de marca; conferir direitos e aprovação no registro central. |
| [`koma-logo-fundo-escuro.png`](../../src/assets/brand/koma/koma-logo-fundo-escuro.png) | PNG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Kit de marca; conferir direitos e aprovação no registro central. |
| [`koma-logo-fundo-escuro.svg`](../../src/assets/brand/koma/koma-logo-fundo-escuro.svg) | SVG | Sem ocorrência literal encontrada; pode haver caminho dinâmico. | Kit de marca; conferir direitos e aprovação no registro central. |
| [`koma-symbol-on-dark.svg`](../../src/assets/brand/koma-symbol-on-dark.svg) | SVG | `src/brand/komaBrand.ts` | Informado como oficial; evidência de cessão/licença pendente no registro central. |
| [`koma-symbol-on-light.svg`](../../src/assets/brand/koma-symbol-on-light.svg) | SVG | `src/brand/komaBrand.ts` | Informado como oficial; evidência de cessão/licença pendente no registro central. |
| [`koma-wordmark-on-dark.svg`](../../src/assets/brand/koma-wordmark-on-dark.svg) | SVG | `src/brand/komaBrand.ts` | Informado como oficial; evidência de cessão/licença pendente no registro central. |
| [`koma-wordmark-on-light.svg`](../../src/assets/brand/koma-wordmark-on-light.svg) | SVG | `src/brand/komaBrand.ts` | Informado como oficial; evidência de cessão/licença pendente no registro central. |

## Prévia da assinatura

| Fundo escuro | Fundo claro |
| --- | --- |
| ![Assinatura para fundo escuro](../../src/assets/brand/koma-wordmark-on-dark.svg) | ![Assinatura para fundo claro](../../src/assets/brand/koma-wordmark-on-light.svg) |

As prévias dependem do fundo do visualizador; escolher a variante adequada à superfície. Componentes SVG em código, ícones de bibliotecas, fontes externas, arquivos fora dessas pastas e recursos recebidos de restaurantes ainda requerem inventário adicional. A comparação de telas está em [VISUAL-2026-11-02](VISUAL-2026-11-02.md).
