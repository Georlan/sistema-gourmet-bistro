// Production export of the generated frame: same vector cutout used by the
// web component, baked into PNG alpha so the asset is portable on any backdrop.
// No repainting, rescaling or replacement of the image-generated metal texture.
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node scripts/export_tablet_shell.mjs source.png destination.png');
if (resolve(source) === resolve(destination)) throw new Error('Keep the generated source; choose a new output path.');
try { await access(destination); throw new Error(`Output already exists: ${destination}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const { default: sharp } = await import(process.env.KOMA_IMAGE_TOOLS || 'sharp');
const geometry = JSON.parse(await readFile(new URL('../src/landing/product/tabletFrameGeometry.json', import.meta.url), 'utf8'));
const original = await readFile(source);
const metadata = await sharp(original).metadata();
if (metadata.width !== geometry.sourceWidth || metadata.height !== geometry.sourceHeight) {
  throw new Error('The cutout coordinates require the approved 1536×1024 source.');
}
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.sourceWidth}" height="${geometry.sourceHeight}"><path d="${geometry.outline} ${geometry.display}" fill="white" fill-rule="evenodd"/></svg>`);
const isolated = await sharp(original).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
await sharp(isolated).extract(geometry.crop).png({ compressionLevel: 9 }).toFile(destination);

const { data, info } = await sharp(destination).raw().toBuffer({ resolveWithObject: true });
const alpha = (x, y) => data[(y * info.width + x) * info.channels + info.channels - 1];
if (info.channels !== 4 || alpha(0, 0) !== 0 || alpha(600, 450) !== 0 || alpha(630, 40) !== 255) {
  throw new Error('Alpha verification failed: background and display must be transparent; bezel must remain opaque.');
}
console.log(JSON.stringify({ output: destination, width: info.width, height: info.height, channels: info.channels, transparentBackground: true, transparentScreen: true, opaqueBezel: true }));
