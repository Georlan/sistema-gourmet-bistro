import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV36';

export const LEGAL_SOURCE_COMMIT = 'c52acb2ed6652fe4ebfaadccd76c0cb5d2b44703';
export const LEGAL_SOURCE_BLOB_SHA = 'e04f39191df88b845bf10c43ae26b18de5af751b';

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
