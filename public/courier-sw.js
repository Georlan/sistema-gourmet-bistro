/* Offline shell ONLY for /entregador. Business data stays in the encrypted app cache.
 * Hashed static assets plus the theme bootstrap only; never cache HTTP API, credentials, HTML from other screens,
 * third-party requests, writes, or order confirmation. Root push worker is independent. */
const PREFIX='koma-courier-shell-v1:';
const asset=url=>url.origin===self.location.origin && (url.pathname==='/theme-init.js' || /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(js|css|svg|png|webp|woff2?)$/.test(url.pathname));
const courier=url=>url.origin===self.location.origin && /^\/entregador\/?$/.test(url.pathname);
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='CACHE_COURIER_SHELL')return;
  event.waitUntil((async()=>{
    const client=event.source?.id && await self.clients.get(event.source.id);
    if(!client || !courier(new URL(client.url)))return;
    const entry=new URL(event.data.entry,self.location.origin);
    if(!asset(entry) || !entry.pathname.endsWith('.js'))return;
    const urls=[...new Set([entry.href,new URL('/theme-init.js',self.location.origin).href,...(Array.isArray(event.data.assets)?event.data.assets:[])])].slice(0,100).map(value=>new URL(value,self.location.origin)).filter(asset);
    const response=await fetch('/entregador',{cache:'no-store'});
    if(!response.ok || !response.headers.get('content-type')?.includes('text/html'))return;
    const html=await response.clone().text();
    // An old open tab must not cache new HTML with old JS, or evict the new version.
    if(!html.includes(`src="${entry.pathname}"`) && !html.includes(`src='${entry.pathname}'`))return;
    const cache=await caches.open(PREFIX+entry.pathname.split('/').pop());
    const documentAssets=[...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match=>new URL(match[1],self.location.origin)).filter(asset);
    await cache.addAll([...new Set([...urls,...documentAssets].map(url=>url.href))]);
    await cache.put('/entregador',response);
    for(const name of await caches.keys())if(name.startsWith(PREFIX) && name!==PREFIX+entry.pathname.split('/').pop())await caches.delete(name);
    event.source.postMessage({type:'COURIER_SHELL_READY'});
  })().catch(()=>event.source?.postMessage({type:'COURIER_SHELL_FAILED'})));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET')return;
  if(request.mode==='navigate' && courier(url)){
    event.respondWith(fetch(request).catch(async()=>{
      for(const name of (await caches.keys()).filter(name=>name.startsWith(PREFIX)).reverse()){
        const response=await (await caches.open(name)).match('/entregador');if(response)return response;
      }
      return new Response('Conecte à internet para abrir o app pela primeira vez.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }));
  }else if(asset(url)){
    event.respondWith((async()=>{
      for(const name of (await caches.keys()).filter(name=>name.startsWith(PREFIX)).reverse()){
        const response=await (await caches.open(name)).match(request,{ignoreVary:true});if(response)return response;
      }
      const response=await fetch(request);
      if(response.ok){const names=(await caches.keys()).filter(name=>name.startsWith(PREFIX));if(names.length)await(await caches.open(names[names.length-1])).put(request,response.clone());}
      return response;
    })());
  }
});
