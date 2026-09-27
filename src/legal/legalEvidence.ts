import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV33';

export const LEGAL_SOURCE_COMMIT = '4833ec753826013e664f2021ba91a24d897db728';
export const LEGAL_SOURCE_BLOB_SHA = '3d765459e76fc5468dc0ce1a48097f13fa7feb21';

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
