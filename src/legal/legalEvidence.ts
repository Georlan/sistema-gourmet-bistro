import { LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from './legalContentV31';

export const LEGAL_SOURCE_COMMIT = 'c38ac9e62aff753d141b5bde05db3eabbfdffde8';
export const LEGAL_SOURCE_BLOB_SHA = '63cbddd9cc91b08fa1190a4460d62d61d3ea73e6';

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
