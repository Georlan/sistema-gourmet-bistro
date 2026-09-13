import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentRecurring';

export const LEGAL_SOURCE_COMMIT = '1203af29bc727297e5b94980b28c573d9fb2ca7b';
export const LEGAL_SOURCE_BLOB_SHA = '49fa7df68faf99544fa48c86491d2f094cc97ccc';

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
