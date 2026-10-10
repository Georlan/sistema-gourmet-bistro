import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV34';

export const LEGAL_SOURCE_COMMIT = '95f1cae2af41bb5b09181c141ee460df534f619c';
export const LEGAL_SOURCE_BLOB_SHA = 'd425a9e803cab0be0ed787c7c658677d5ae4cfdc';

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
