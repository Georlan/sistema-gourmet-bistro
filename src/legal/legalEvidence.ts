import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV32';

export const LEGAL_SOURCE_COMMIT = '70015843a88c09eff0edf503897de2a0abe33fcf';
export const LEGAL_SOURCE_BLOB_SHA = '4783f58da5481a59badf868b07eb42c80c0b5b3a';

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
