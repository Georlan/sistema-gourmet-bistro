import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentRecurring';

export const LEGAL_SOURCE_COMMIT = 'c5d1cb0f66f082868b782a90520a6fa9da87aab6';
export const LEGAL_SOURCE_BLOB_SHA = '8ef0cd658420969d8429f723b4f72dee96c6f011';

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
