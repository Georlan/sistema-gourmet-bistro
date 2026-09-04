(function () {
  var pathname = window.location.pathname;
  var params = new URLSearchParams(window.location.search);
  var hostname = window.location.hostname.toLowerCase();
  var parts = hostname.split('.');
  var ignoredSubdomains = ['www', 'localhost', 'sistema-gourmet-bistro'];
  var isPlatformHost = hostname.endsWith('.pages.dev')
    || hostname.endsWith('.railway.app')
    || hostname.endsWith('.up.railway.app')
    || hostname.endsWith('.vercel.app')
    || hostname.endsWith('.netlify.app')
    || hostname.endsWith('.github.io');
  var isPublicMenuRoute = pathname.indexOf('/cardapio') === 0
    || params.get('view') === 'cardapio'
    || (
      parts.length > 2
      && ignoredSubdomains.indexOf(parts[0]) === -1
      && parts[0].indexOf('ais-dev') !== 0
      && parts[0].indexOf('ais-pre') !== 0
      && !isPlatformHost
    );

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