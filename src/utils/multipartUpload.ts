/**
 * Remove Content-Type (case-insensitive) para uploads multipart/form-data com FormData,
 * permitindo que o navegador defina o boundary correto preservando Authorization e demais headers.
 */
export function buildMultipartUploadHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== 'content-type') {
      result[key] = value;
    }
  }
  return result;
}
