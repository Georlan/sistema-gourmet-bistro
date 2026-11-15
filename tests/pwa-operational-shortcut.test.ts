import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const themeInit = readFileSync("public/theme-init.js", "utf8");

function resolvePwaEntry(hostname: string, pathname = "/", search = "", hash = "") {
  const location = { hostname, pathname, search, hash };
  const manifest = { href: "/manifest-operational.webmanifest" };
  let replacedTo: string | null = null;
  let theme: string | null = null;

  const mockedWindow = {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        replacedTo = url;
        location.pathname = url;
      },
    },
    localStorage: {
      getItem: (key: string) => (key === "@koma:theme" ? "light" : null),
    },
  };
  const mockedDocument = {
    getElementById: (id: string) => (id === "koma-manifest" ? manifest : null),
    documentElement: {
      setAttribute: (name: string, value: string) => {
        if (name === "data-koma-theme") theme = value;
      },
    },
  };

  runInNewContext(themeInit, {
    window: mockedWindow,
    document: mockedDocument,
    URLSearchParams,
  });

  return { pathname: location.pathname, manifest: manifest.href, replacedTo, theme };
}

test("domínio operacional instala o PWA da equipe e preserva o tema do operador", () => {
  assert.deepEqual(resolvePwaEntry("app.komafood.com.br"), {
    pathname: "/",
    manifest: "/manifest-operational.webmanifest",
    replacedTo: null,
    theme: "light",
  });
});

test("atalhos PWA antigos com /cardapio sem restaurante abrem o login operacional", () => {
  for (const path of ["/cardapio", "/cardapio/"]) {
    assert.deepEqual(resolvePwaEntry("app.komafood.com.br", path), {
      pathname: "/",
      manifest: "/manifest-operational.webmanifest",
      replacedTo: "/",
      theme: "light",
    });
  }
});

test("links explícitos de cardápio no domínio app não são redirecionados", () => {
  for (const [path, query, hash] of [
    ["/cardapio", "?restaurante_id=6", ""],
    ["/cardapio", "?slug=restaurante-a", ""],
    ["/cardapio", "", "#koma-order=pedido-123"],
    ["/c/restaurante-a", "", ""],
  ]) {
    const result = resolvePwaEntry("app.komafood.com.br", path, query, hash);
    assert.equal(result.pathname, path);
    assert.equal(result.manifest, "/manifest.webmanifest");
    assert.equal(result.replacedTo, null);
    assert.equal(result.theme, "dark");
  }
});

test("domínio público do restaurante mantém manifesto e identidade de cardápio", () => {
  assert.deepEqual(resolvePwaEntry("restaurante-a.komafood.com.br"), {
    pathname: "/",
    manifest: "/manifest.webmanifest",
    replacedTo: null,
    theme: "dark",
  });
});

test("manifesto operacional abre na raiz, sem alterar dados de tenant na URL", () => {
  const operational = JSON.parse(readFileSync("public/manifest-operational.webmanifest", "utf8")) as {
    id: string;
    start_url: string;
    scope: string;
  };
  assert.equal(operational.id, "/");
  assert.equal(operational.start_url, "/");
  assert.equal(operational.scope, "/");
});
