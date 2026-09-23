import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV28';

export const LEGAL_SOURCE_COMMIT = 'a7069485bb9b086af2988cd06a1a3cc2477ce70d';
export const LEGAL_SOURCE_BLOB_SHA = 'd49a9e7163a8f124c526b63dad9ea324bf99399c';

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
