# Retirada do Frontend legado da Railway

Data da verificação: 24/09/2026.

## Estado observado

O serviço legado continua presente no projeto Railway de produção:

- serviço: `Frontend`
- service id: `8cbcc4d1-434b-49e7-ad23-1f5627d61d45`
- source: `Georlan/sistema-gourmet-bistro`, branch `main`
- domínio Railway: `frontend-production-4805.up.railway.app`
- custom domain ainda anexado: `app.komafood.com.br`
- `sleepApplication=true`
- variáveis diretamente configuradas: `NODE_ENV`, `VITE_API_URL` e `VITE_WS_URL`

Existe uma alteração **staged**, criada em 18/09/2026, que marca o serviço inteiro
para exclusão. Ela ainda não foi aplicada. Não aceitar esse staged change junto
com outras alterações de produção sem executar os gates abaixo.

## Evidência de tráfego

Na consulta de logs HTTP da Railway entre 17/09/2026 e 24/09/2026 foram retornadas
cinco requisições para o serviço. Todas usaram o host
`frontend-production-4805.up.railway.app`; nenhuma usou
`app.komafood.com.br`.

Isso é evidência forte de que o domínio público não está chegando ao serviço
legado, mas não substitui a verificação do registro DNS autoritativo/Cloudflare.
A integração disponível nesta revisão não expõe a zona DNS da Cloudflare, então
a remoção definitiva continua bloqueada por essa última confirmação.

## Gate antes de aplicar a exclusão staged

1. Na Cloudflare, confirmar que `app.komafood.com.br` aponta para o frontend
   publicado no Pages e não para o custom domain/target da Railway.
2. Conferir que o deploy ativo do Pages responde pelo SHA esperado da `main`.
3. Repetir um acesso real a `https://app.komafood.com.br` e confirmar que ele
   não produz entrada HTTP com esse host no serviço Railway.
4. Registrar os valores protegidos de `VITE_API_URL` e `VITE_WS_URL` em local
   seguro antes de aceitar a exclusão. O acesso OAuth usado nesta revisão expõe
   os nomes, não os valores.
5. Só então aplicar isoladamente a exclusão staged do serviço `Frontend`.

## Plano de reversão

Se houver regressão após a retirada:

1. recriar um serviço `Frontend` no mesmo projeto a partir de
   `Georlan/sistema-gourmet-bistro`, branch `main`;
2. restaurar `NODE_ENV`, `VITE_API_URL` e `VITE_WS_URL` a partir do registro
   seguro feito antes da exclusão;
3. restaurar healthcheck `/`, runtime e configuração de build equivalentes;
4. recolocar o domínio customizado somente se a reversão realmente exigir que o
   tráfego volte à Railway;
5. validar login, Caixa e Cardápio Online antes de considerar a reversão concluída.

Nenhum deploy, redeploy ou aceite do staged change foi executado durante esta
revisão.
