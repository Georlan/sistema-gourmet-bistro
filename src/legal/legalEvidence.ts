import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV30';

export const LEGAL_SOURCE_COMMIT = '4542a662c2591e25f5a5a47debd6b3048cdcf239';
export const LEGAL_SOURCE_BLOB_SHA = '6b3c08b0d2dd1cbd9889e4755aad03052be99e45';

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
