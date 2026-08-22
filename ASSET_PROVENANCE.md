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
| `public/logo-koma.png` | `f85e318b22d24e5e07d0db896a261aa7b5c4cef4ab237cbdcb077970c4d0aeeb` | favicon público | PENDENTE | arquivo-fonte, autoria e cessão/licença |
| `src/assets/logo-koma-on-dark.png` | `cc1b6844e3a1a0142e0b1c984fb2feff9c20b861c918960a3e642ad1a5f520d5` | interface em fundo escuro | PENDENTE | arquivo-fonte, autoria e cessão/licença |
| `src/assets/logo-koma-on-light.png` | `f52235eb9d331c34f523f87b3a88dfa6bee2a60148a1be2030fb751ffe21bd0f` | interface em fundo claro | PENDENTE | arquivo-fonte, autoria e cessão/licença |
| `src/assets/logo-koma-on-green.png` | `27061b1213652575b36a3c37badc11048b8e0a8a82fbbf10a4e48965aad12b16` | landing page | PENDENTE | arquivo-fonte, autoria e cessão/licença |
| `src/assets/koma-phone-shell-3d.png` | `0d6a1136cf1828e5e255932abf48cfd9b08e0d4dfc215f226dd906a027e26652` | mockup da landing page | PENDENTE | origem do mockup/modelo 3D e licença comercial |
| `src/assets/koma-tablet-shell-3d.png` | `a7c31552ed4a0554bc474ec821a235d997b10677b79a2b9ef1b212dcd8cc7560` | mockup da landing page | PENDENTE | origem do mockup/modelo 3D e licença comercial |
| `src/brand/komaBrand.ts` (`KOMA_WORDMARK_SRC`, WebP 240×80) | `10eece546c559bd52e51d752a901dc8ec4f231df4ad83bc011360f073ef8687e` | wordmark incorporado como data URL | PENDENTE | arquivo-fonte, autoria e cessão/licença; o hash é do WebP decodificado |

## Ativos externos e enviados por clientes

- As fontes carregadas pelo navegador a partir do Google Fonts não são ativos próprios da KÔMA. Licença, privacidade e eventual hospedagem local devem ser avaliadas antes da release.
- Logos, banners e fotografias enviados por restaurantes pertencem ao respectivo tenant. Os termos do SaaS devem exigir autorização de uso e definir remoção, retenção e responsabilidade por conteúdo de terceiros.
- Marcas de adquirentes, marketplaces, redes sociais e fabricantes só podem ser usadas conforme seus guias oficiais; integração técnica não concede direito de co-branding.

## Controle de release

Antes de cada release, gere novamente os hashes, compare este arquivo com os ativos versionados e bloqueie a publicação quando houver arquivo sem registro ou evidência. Comprovantes, contratos e documentos pessoais não devem ser armazenados neste repositório público.
