(function () {
  var pathname = window.location.pathname;
  var hostname = window.location.hostname.toLowerCase();
  var isOperationalAppHost = hostname === 'app.komafood.com.br';

  // Corrige atalhos PWA antigos, instalados com start_url=/cardapio.
  // Redireciona somente a entrada sem identificador; links reais de cardápio
  // com restaurante_id, slug ou hash continuam intactos.
  if (
    isOperationalAppHost
    && (pathname === '/cardapio' || pathname === '/cardapio/')
    && !window.location.search
    && !window.location.hash
  ) {
    window.history.replaceState(window.history.state, '', '/');
    pathname = '/';
  }

  var params = new URLSearchParams(window.location.search);
  var parts = hostname.split('.');
  var ignoredSubdomains = ['www', 'localhost', 'sistema-gourmet-bistro', 'komafood'];
  var isPlatformHost = hostname.endsWith('.pages.dev')
    || hostname === 'komafood.com.br'
    || hostname === 'www.komafood.com.br'
    || hostname.endsWith('.railway.app')
    || hostname.endsWith('.up.railway.app')
    || hostname.endsWith('.vercel.app')
    || hostname.endsWith('.netlify.app')
    || hostname.endsWith('.github.io');
  var isPublicMenuRoute = pathname.indexOf('/cardapio') === 0
    || pathname.indexOf('/c/') === 0
    || params.get('view') === 'cardapio'
    || (
      parts.length > 2
      && ignoredSubdomains.indexOf(parts[0]) === -1
      && parts[0].indexOf('ais-dev') !== 0
      && parts[0].indexOf('ais-pre') !== 0
      && !isPlatformHost
      && !isOperationalAppHost
    );

  // O mesmo origin atende duas superfícies instaláveis diferentes. O manifesto
  // operacional sempre inicia na raiz; o cardápio público preserva o manifesto
  // de pedidos para não transformar um atalho da equipe em /cardapio.
  var manifestLink = document.getElementById('koma-manifest');
  if (manifestLink) {
    manifestLink.href = isPublicMenuRoute
      ? '/manifest.webmanifest'
      : '/manifest-operational.webmanifest';
  }

  // O cardápio público possui apresentação própria. Nunca usa a preferência
  // de tema gravada pelo operador no mesmo origin.
  if (isPublicMenuRoute) {
    document.documentElement.setAttribute('data-koma-theme', 'dark');
    return;
  }

  var theme = 'dark';
  try {
    var storedTheme = window.localStorage.getItem('@koma:theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      theme = storedTheme;
    }
  } catch (_) {
    // localStorage pode estar indisponível por política do navegador.
  }

  document.documentElement.setAttribute('data-koma-theme', theme);
})();