# Registro de proveniência de ativos — KÔMA

Este registro impede que um ativo visual seja tratado como propriedade da KÔMA sem evidência. Ele não transfere direitos e não substitui contrato, cessão, licença ou pesquisa de marca.

## Regra de entrada

Nenhum logo, imagem, vídeo, fonte, áudio, apresentação, texto de campanha ou material gerado por ferramenta deve entrar em uma release comercial sem:

1. origem, criador e data;
2. contrato, cessão ou licença aplicável;
3. autorização de imagem, voz, marca e dados pessoais, quando necessária;
4. termos da ferramenta vigentes na data, se houver geração assistida;
5. hash do arquivo distribuído;
6. localização privada da evidência, com acesso restrito;
7. aprovação humana registrada.

Arquivos com situação `PENDENTE` podem permanecer apenas para avaliação interna. A presença neste repositório não comprova titularidade.

## Inventário atual

| Ativo | SHA-256 | Uso | Situação | Evidência necessária |
|---|---|---|---|---|
| `public/logo-koma.png` | `f52235eb9d331c34f523f87b3a88dfa6bee2a60148a1be2030fb751ffe21bd0f` | fallback do favicon público | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `public/koma-logo-on-light.svg` | `ca3a2350efae385a2dbd9111c0e174823cdc42677f8604f1e1b67cad5ae5d4f3` | favicon em tema claro | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `public/koma-logo-on-dark.svg` | `5c0accd0d6cb283e1114e08546ed462f8f4073e37f4bcff1e78b1e714766671d` | favicon em tema escuro | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/logo-koma-on-dark.png` | `cc1b6844e3a1a0142e0b1c984fb2feff9c20b861c918960a3e642ad1a5f520d5` | interface em fundo escuro | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/logo-koma-on-light.png` | `f52235eb9d331c34f523f87b3a88dfa6bee2a60148a1be2030fb751ffe21bd0f` | interface em fundo claro | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/logo-koma-on-green.png` | `f52235eb9d331c34f523f87b3a88dfa6bee2a60148a1be2030fb751ffe21bd0f` | compatibilidade da landing page | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/brand/koma-symbol-on-light.svg` | `ca3a2350efae385a2dbd9111c0e174823cdc42677f8604f1e1b67cad5ae5d4f3` | símbolo em fundo claro | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/brand/koma-symbol-on-dark.svg` | `5c0accd0d6cb283e1114e08546ed462f8f4073e37f4bcff1e78b1e714766671d` | símbolo em fundo escuro | INFORMADO COMO OFICIAL | pacote `komalogos.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/brand/koma-wordmark-on-light.svg` | `f20c445ceb17fdcae7f8d28361af12fec98c4135382831184209cab575264161` | assinatura refinada em fundo claro | INFORMADO COMO OFICIAL | pacote `koma-wordmark-refinado-kit.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/brand/koma-wordmark-on-dark.svg` | `bc50e9f145496c6c5e349811b1b1f5fe77cc5f716f2aeab0d88948cc5a3bbc05` | assinatura refinada em fundo escuro | INFORMADO COMO OFICIAL | pacote `koma-wordmark-refinado-kit.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |
| `src/assets/koma-phone-shell-3d.png` | `0d6a1136cf1828e5e255932abf48cfd9b08e0d4dfc215f226dd906a027e26652` | mockup da landing page | PENDENTE | origem do mockup/modelo 3D e licença comercial |
| `src/assets/koma-tablet-shell-3d.png` | `a7c31552ed4a0554bc474ec821a235d997b10677b79a2b9ef1b212dcd8cc7560` | mockup da landing page | PENDENTE | origem do mockup/modelo 3D e licença comercial |
| `komalogo.png` | `99e587831acb4819c1bc6d74e0a6efb41163e9f103676341c90d874fad8548df` | referência raster da assinatura refinada | INFORMADO COMO OFICIAL | pacote `koma-wordmark-refinado-kit.zip` fornecido em 28/08/2026; arquivar evidência de autoria e cessão/licença |

## Ativos externos e enviados por clientes

- As fontes carregadas pelo navegador a partir do Google Fonts não são ativos próprios da KÔMA. Licença, privacidade e eventual hospedagem local devem ser avaliadas antes da release.
- Logos, banners e fotografias enviados por restaurantes pertencem ao respectivo tenant. Os termos do SaaS devem exigir autorização de uso e definir remoção, retenção e responsabilidade por conteúdo de terceiros.
- Marcas de adquirentes, marketplaces, redes sociais e fabricantes só podem ser usadas conforme seus guias oficiais; integração técnica não concede direito de co-branding.

## Controle de release

Antes de cada release, gere novamente os hashes, compare este arquivo com os ativos versionados e bloqueie a publicação quando houver arquivo sem registro ou evidência. Comprovantes, contratos e documentos pessoais não devem ser armazenados neste repositório público.
