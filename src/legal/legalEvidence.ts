import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV27';

export const LEGAL_SOURCE_COMMIT = '2444da94869eddaa177db5b5f78e27f0ea75057a';
export const LEGAL_SOURCE_BLOB_SHA = '7182e8e3332fd47db94e73edf6fb635ebfe0cff5';

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
