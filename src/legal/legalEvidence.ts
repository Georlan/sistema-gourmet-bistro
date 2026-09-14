import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentRecurring';

export const LEGAL_SOURCE_COMMIT = '9cea04e26a4c80a4e51868d7e23dbb7139d81167';
export const LEGAL_SOURCE_BLOB_SHA = '41e18218432e43a3298ceb3084613782db623135';

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
