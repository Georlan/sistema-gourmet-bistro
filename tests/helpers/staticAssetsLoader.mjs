// Match the URL-export shape of Vite's static modules for node:test SSR only.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.svg') || url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.webp')) {
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
  }
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default {};' };
  }
  return nextLoad(url, context);
}
