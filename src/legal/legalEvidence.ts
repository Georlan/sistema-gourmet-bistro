import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV35';

export const LEGAL_SOURCE_COMMIT = '59f1024523c66c814c403425aac993e0fab9cd15';
export const LEGAL_SOURCE_BLOB_SHA = '5abbaf4325c2c4531c31b9e6f910dc6c97b045bb';

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
