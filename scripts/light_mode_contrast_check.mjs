import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const cssPath = new URL('src/index.css', root);
const css = await readFile(cssPath, 'utf8');

const lightBlock = css.match(/\[data-koma-theme="light"\]\s*\{([\s\S]*?)\n\}/)?.[1];
if (!lightBlock) throw new Error('Bloco de tokens do modo claro não encontrado.');

const tokens = Object.fromEntries(
  [...lightBlock.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [name, value]),
);

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const checks = [
  ['koma-text-primary', 'koma-surface-panel'],
  ['koma-text-secondary', 'koma-surface-panel'],
  ['koma-text-muted', 'koma-surface-panel'],
  ['koma-text-subtle', 'koma-surface-panel'],
  ['koma-accent', 'koma-surface-panel'],
  ['koma-success-text', 'koma-success-bg'],
  ['koma-danger-text', 'koma-danger-bg'],
  ['koma-warning-text', 'koma-warning-bg'],
  ['koma-info-text', 'koma-info-bg'],
  ['koma-stage-salon', 'koma-surface-raised'],
  ['koma-stage-digital', 'koma-surface-raised'],
  ['koma-stage-closing', 'koma-surface-raised'],
  ['koma-light-emerald-text', 'koma-surface-panel'],
  ['koma-light-blue-text', 'koma-surface-panel'],
  ['koma-light-sky-text', 'koma-surface-panel'],
  ['koma-light-cyan-text', 'koma-surface-panel'],
  ['koma-light-amber-text', 'koma-surface-panel'],
  ['koma-light-yellow-text', 'koma-surface-panel'],
  ['koma-light-orange-text', 'koma-surface-panel'],
  ['koma-light-red-text', 'koma-surface-panel'],
  ['koma-light-rose-text', 'koma-surface-panel'],
  ['koma-light-purple-text', 'koma-surface-panel'],
  ['koma-light-pink-text', 'koma-surface-panel'],
  ['koma-light-indigo-text', 'koma-surface-panel'],
  ['koma-light-neutral-text', 'koma-surface-panel'],
];

const failures = [];
for (const [foregroundName, backgroundName] of checks) {
  const foreground = tokens[foregroundName];
  const background = tokens[backgroundName];
  if (!foreground || !background) {
    failures.push(`Token ausente: ${foregroundName} ou ${backgroundName}`);
    continue;
  }

  const ratio = contrast(foreground, background);
  console.log(`${foregroundName} / ${backgroundName}: ${ratio.toFixed(2)}:1`);
  if (ratio < 4.5) failures.push(`${foregroundName} em ${backgroundName}: ${ratio.toFixed(2)}:1`);
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(path));
    else if (['.css', '.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const path of await collectSourceFiles(join(rootPath, 'src'))) {
  if (path.endsWith('komaBrand.ts')) continue;
  const source = await readFile(path, 'utf8');
  const malformedOpacity = source.match(/[A-Za-z][A-Za-z0-9_\[\]#.-]*\/\d+\/\d+/g) ?? [];
  for (const value of malformedOpacity) failures.push(`Classe de opacidade inválida em ${path}: ${value}`);
  if (/transition\s*:[^;]*\b\d{3,}s\b/.test(source)) failures.push(`Transição excessiva em ${path}`);
}

if (failures.length) {
  console.error('\nAuditoria do modo claro falhou:\n- ' + failures.join('\n- '));
  process.exit(1);
}

console.log('\nModo claro aprovado: contraste AA e integridade visual sem regressões conhecidas.');
