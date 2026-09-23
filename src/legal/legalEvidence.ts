import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV27';

export const LEGAL_SOURCE_COMMIT = 'f251de927fd2484059eea3ca84847378163f7d02';
export const LEGAL_SOURCE_BLOB_SHA = 'e34b710500118239876b7ae7a85a2e2fff99f9b4';

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
