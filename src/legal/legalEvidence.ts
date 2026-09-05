import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContent';

export const LEGAL_SOURCE_COMMIT = '46a12af35418f1877d68a95c66d5cacc0ea62a11';
export const LEGAL_SOURCE_BLOB_SHA = '6ee232ec971ad2b7e453b3e543961118087383f4';

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
