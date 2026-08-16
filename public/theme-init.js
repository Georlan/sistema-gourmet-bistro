(function () {
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
