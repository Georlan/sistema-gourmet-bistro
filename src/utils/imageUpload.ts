export type ImageAssetKind = 'products' | 'logo' | 'banner';
export const MAX_IMAGE_UPLOAD_SOURCE_BYTES = 20 * 1024 * 1024;
export const IMAGE_UPLOAD_EDGES = { products: 1280, logo: 512, banner: 1920 } as const;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

function validateRaster(bytes: Uint8Array, type: string) {
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const png = bytes[0] === 137 && ascii(1, 3) === 'PNG';
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (!(type === 'image/png' ? png : type === 'image/webp' ? webp : jpeg)) {
    throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Check the actual chunks, never text inside pixel data. Do not silently flatten animation.
  for (let offset = png ? 8 : 12; (png || webp) && offset + 8 <= bytes.length;) {
    const size = view.getUint32(png ? offset : offset + 4, !png);
    const chunk = ascii(png ? offset + 4 : offset, 4);
    if (chunk === 'acTL' || chunk === 'ANIM' || chunk === 'ANMF') {
      throw new Error('Use uma imagem estática, sem animação.');
    }
    offset += png ? size + 12 : size + 8 + size % 2;
  }
}

/** Resize before sending; the server still validates and enforces the publication budget. */
export async function prepareImageUpload(file: File, kind: ImageAssetKind): Promise<File> {
  const type = file.type.toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) throw new Error('Use PNG, JPG ou WEBP.');
  if (file.size > MAX_IMAGE_UPLOAD_SOURCE_BYTES) throw new Error('A imagem deve ter no máximo 20 MB.');
  validateRaster(new Uint8Array(await file.arrayBuffer()), type);
  let image: CanvasImageSource;
  let width: number;
  let height: number;
  let dispose: () => void;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    image = bitmap; width = bitmap.width; height = bitmap.height;
    dispose = () => bitmap.close();
  } else {
    const objectUrl = URL.createObjectURL(file);
    const fallback = new Image();
    try {
      fallback.src = objectUrl;
      await fallback.decode();
    } catch {
      URL.revokeObjectURL(objectUrl);
      throw new Error('Não foi possível ler a imagem. Escolha outra foto.');
    }
    image = fallback; width = fallback.naturalWidth; height = fallback.naturalHeight;
    dispose = () => URL.revokeObjectURL(objectUrl);
  }
  try {
    if (width * height > 48_000_000) throw new Error('A foto é muito grande. Use uma imagem de até 48 megapixels.');
    const scale = Math.min(1, IMAGE_UPLOAD_EDGES[kind] / Math.max(width, height));
    // Already-small inputs go directly to the canonical server encoder, avoiding another lossy pass.
    if (scale === 1 && file.size <= 5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a imagem neste navegador.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Logos keep lossless pixels and alpha; the backend then encodes compact WebP.
    const outputType = kind === 'logo' ? 'image/png' : 'image/webp';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.94));
    if (!blob || blob.type !== outputType || blob.size > 5 * 1024 * 1024) {
      throw new Error('Não foi possível preparar a foto para envio. Escolha outra imagem.');
    }
    if (blob.size >= file.size && file.size <= 5 * 1024 * 1024 && width * height <= 24_000_000) return file;
    return new File([blob], `${kind}.${kind === 'logo' ? 'png' : 'webp'}`, { type: blob.type });
  } finally {
    dispose();
  }
}
