# Frontend Railway legado · decisão de retirada

Verificado em 27/09/2026. O frontend público é o projeto Cloudflare Pages `sistema-gourmet-bistro` no commit `c6a92e5a6dadb13c935a8981ff101e06e230d60b` (check Cloudflare Pages SUCCESS). `app.komafood.com.br` e `sistema-gourmet-bistro.pages.dev` retornaram HTML idêntico, mesmo bundle `index-B00G9jcm.js`, TLS válido e injeção de Cloudflare Pages Analytics. O bundle publicado contém a URL da API Railway de produção. Smoke GET/OPTIONS passou no domínio público.

O domínio customizado no Railway `Frontend` apontava para um alvo Railway diferente do DNS em uso, estava sem verificação de titularidade e sem certificado Railway concluído. Após acesso ao domínio público, os logs HTTP do serviço Railway não registraram tráfego. O vínculo `app.komafood.com.br` foi retirado do serviço Railway; a leitura posterior mostrou `customDomains=[]` e o domínio público continuou 200 com TLS válido. Nenhum patch Railway ficou staged.

O painel Cloudflare mostrou que `app` passava por uma rota Worker wildcard para `pages.dev`. `app.komafood.com.br` foi cadastrado como custom domain do Pages, ganhou CNAME exato e ficou **Active / SSL enabled**. A rota Worker `*.komafood.com.br/*` foi retirada; a rota exclusiva `www.komafood.com.br/*` permanece para o redirect. Depois disso, `app` e `pages.dev` seguiram com HTTP 200, HTML idêntico e TLS válido.

Após confirmação explícita do usuário, o serviço Railway `Frontend` (`8cbcc4d1-434b-49e7-ad23-1f5627d61d45`) foi excluído. A releitura do projeto não lista mais o serviço e mostra zero patches pendentes. A API continuou respondendo 200.
