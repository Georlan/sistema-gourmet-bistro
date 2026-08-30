// Match the URL-export shape of Vite's SVG modules for node:test SSR only.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.svg')) {
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
  }
  return nextLoad(url, context);
}
