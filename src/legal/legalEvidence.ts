import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV28';

export const LEGAL_SOURCE_COMMIT = 'd6b8a35d97e57470f4a869a626e457fdf1892305';
export const LEGAL_SOURCE_BLOB_SHA = 'd320afb497221bc75b7e2f987900f0a6b673a8d9';

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
