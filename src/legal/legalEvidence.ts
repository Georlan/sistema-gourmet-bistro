import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV35';

export const LEGAL_SOURCE_COMMIT = '7b6c49d876848752deb1cbb7b5c6786a87668b6f';
export const LEGAL_SOURCE_BLOB_SHA = '26cf60ecac0ce3dcd30965dfa1d071128f0faf45';

const bySlug = new Map(LEGAL_DOCUMENTS.map(document => [document.slug, document]));

function requireDocument(slug: LegalDocument['slug']): LegalDocument {
  const document = bySlug.get(slug);
  if (!document || document.version !== LEGAL_VERSION) {
    throw new Error(`Documento jurídico indisponível ou desatualizado: ${slug}`);
  }
  return document;
}

export function contractLegalBundle() {
  return {
    terms: requireDocument('termos'),
    commercial: requireDocument('planos'),
    dpa: requireDocument('dpa'),
    privacy: requireDocument('privacidade'),
  };
}
