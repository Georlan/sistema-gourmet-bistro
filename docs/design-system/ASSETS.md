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
