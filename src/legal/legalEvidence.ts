import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentRecurring';

export const LEGAL_SOURCE_COMMIT = '3de1e9085a876fe2e6f9c2a90ff0c8a7a6ca7e79';
export const LEGAL_SOURCE_BLOB_SHA = 'c0f67c3d2eb11602a1cc49615a814e3355e4b623';

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
