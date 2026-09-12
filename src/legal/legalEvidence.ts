import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContent';

export const LEGAL_SOURCE_COMMIT = '55bb4b87dd4f15d4b36adeb8db9a91fda04deba8';
export const LEGAL_SOURCE_BLOB_SHA = '5332d82a994f037082cdea5864522123e25f7012';

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
