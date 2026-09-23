import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV29';

export const LEGAL_SOURCE_COMMIT = 'be570b2b80ce69f15cc002177723d6eea9d31bda';
export const LEGAL_SOURCE_BLOB_SHA = 'b7984f6a0e2cbb5db66c843e009323a6c9219f29';

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
