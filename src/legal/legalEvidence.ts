import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentRecurring';

export const LEGAL_SOURCE_COMMIT = '22df9ec64ce2391ee78630598ea0852a85aab4c1';
export const LEGAL_SOURCE_BLOB_SHA = 'd7f1d9279bba4049e50c23b305f45d374cb24767';

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
