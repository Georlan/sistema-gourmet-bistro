import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, FileText, ShieldCheck } from 'lucide-react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import { LEGAL_DOCUMENTS, findLegalDocument } from './legalContent';
import './legal.css';

function setLegalDocumentMeta(title: string, description: string) {
  document.title = `${title} | KÔMA`;
  let descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!descriptionMeta) {
    descriptionMeta = document.createElement('meta');
    descriptionMeta.name = 'description';
    document.head.appendChild(descriptionMeta);
  }
  descriptionMeta.content = description;
}

function LegalHeader() {
  return (
    <header className="koma-legal-header">
      <a href="/landing" className="koma-legal-brand" aria-label="Voltar para a página inicial do KÔMA">
        <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
      </a>
      <nav aria-label="Navegação legal">
        <a href="/legal">Legal e privacidade</a>
        <a href="/landing#planos" className="koma-legal-header-cta">Ver planos</a>
      </nav>
    </header>
  );
}

function LegalFooter() {
  return (
    <footer className="koma-legal-footer">
      <span>© {new Date().getFullYear()} KÔMA</span>
      <nav aria-label="Documentos legais">
        <a href="/legal/termos">Termos</a>
        <a href="/legal/privacidade">Privacidade</a>
        <a href="/legal/suboperadores">Fornecedores</a>
        <a href="/legal/cardapio-termos">Cardápio</a>
      </nav>
    </footer>
  );
}

function LegalCenter() {
  useEffect(() => {
    setLegalDocumentMeta(
      'Legal e Privacidade',
      'Central pública de documentos legais, privacidade e condições comerciais do KÔMA.',
    );
    window.scrollTo(0, 0);
  }, []);

  const businessDocs = LEGAL_DOCUMENTS.filter((doc) => !doc.slug.startsWith('cardapio-'));
  const consumerDocs = LEGAL_DOCUMENTS.filter((doc) => doc.slug.startsWith('cardapio-'));

  return (
    <div className="koma-legal-shell">
      <LegalHeader />
      <main className="koma-legal-main">
        <section className="koma-legal-hero">
          <div>
            <span className="koma-legal-kicker">KÔMA / LEGAL</span>
            <h1>REGRAS CLARAS.<br /><em>SEM LETRAS MIÚDAS.</em></h1>
            <p>
              Aqui ficam as versões públicas dos documentos que regem a contratação do KÔMA,
              o tratamento de dados, os fornecedores relevantes e o uso do cardápio digital.
            </p>
          </div>
          <aside>
            <ShieldCheck size={26} aria-hidden="true" />
            <strong>DOCUMENTOS VERSIONADOS</strong>
            <p>Cada aceite eletrônico ficará vinculado à versão vigente no momento da contratação.</p>
          </aside>
        </section>

        <section className="koma-legal-group" aria-labelledby="business-legal-title">
          <div className="koma-legal-group-heading">
            <span>01</span>
            <div>
              <h2 id="business-legal-title">PARA RESTAURANTES</h2>
              <p>Contratação, preço, uso da plataforma, fornecedores e proteção de dados.</p>
            </div>
          </div>
          <div className="koma-legal-grid">
            {businessDocs.map((doc) => (
              <a className="koma-legal-card" href={`/legal/${doc.slug}`} key={doc.slug}>
                <FileText size={20} aria-hidden="true" />
                <span>{doc.audience}</span>
                <h3>{doc.shortTitle}</h3>
                <p>{doc.summary}</p>
                <small>v{doc.version} · {doc.effectiveDate}</small>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>

        <section className="koma-legal-group" aria-labelledby="consumer-legal-title">
          <div className="koma-legal-group-heading">
            <span>02</span>
            <div>
              <h2 id="consumer-legal-title">PARA CLIENTES DO CARDÁPIO</h2>
              <p>Informações sobre pedidos, responsabilidades e privacidade.</p>
            </div>
          </div>
          <div className="koma-legal-grid koma-legal-grid--consumer">
            {consumerDocs.map((doc) => (
              <a className="koma-legal-card" href={`/legal/${doc.slug}`} key={doc.slug}>
                <FileText size={20} aria-hidden="true" />
                <span>{doc.audience}</span>
                <h3>{doc.shortTitle}</h3>
                <p>{doc.summary}</p>
                <small>v{doc.version} · {doc.effectiveDate}</small>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>

        <section className="koma-legal-contract-cta">
          <div>
            <span>PRONTO PARA AVANÇAR?</span>
            <h2>ESCOLHA O PLANO QUE FAZ SENTIDO PARA SUA OPERAÇÃO.</h2>
            <p>Compare Pocket, Pro e Premium, leia os documentos e avance para a contratação online.</p>
          </div>
          <a href="/landing#planos">Ver planos <ArrowRight size={18} aria-hidden="true" /></a>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

function LegalDocumentPage({ slug }: { slug: string }) {
  const document = findLegalDocument(slug);

  useEffect(() => {
    if (document) setLegalDocumentMeta(document.title, document.summary);
    else setLegalDocumentMeta('Documento não encontrado', 'Documento legal não encontrado.');
    window.scrollTo(0, 0);
  }, [document]);

  if (!document) {
    return (
      <div className="koma-legal-shell">
        <LegalHeader />
        <main className="koma-legal-main koma-legal-not-found">
          <span>404 / LEGAL</span>
          <h1>DOCUMENTO NÃO ENCONTRADO.</h1>
          <a href="/legal"><ArrowLeft size={18} aria-hidden="true" /> Voltar para a central legal</a>
        </main>
        <LegalFooter />
      </div>
    );
  }

  return (
    <div className="koma-legal-shell">
      <LegalHeader />
      <main className="koma-legal-main koma-legal-document">
        <a className="koma-legal-back" href="/legal"><ArrowLeft size={17} aria-hidden="true" /> Central legal</a>
        <header className="koma-legal-document-head">
          <div>
            <span>{document.audience}</span>
            <h1>{document.title}</h1>
            <p>{document.summary}</p>
          </div>
          <dl>
            <div><dt>Versão</dt><dd>{document.version}</dd></div>
            <div><dt>Vigência</dt><dd>{document.effectiveDate}</dd></div>
          </dl>
        </header>

        <div className="koma-legal-document-layout">
          <aside aria-label="Sumário do documento">
            <strong>NESTE DOCUMENTO</strong>
            <ol>
              {document.sections.map((section, index) => (
                <li key={section.title}><a href={`#legal-section-${index + 1}`}>{section.title}</a></li>
              ))}
            </ol>
          </aside>

          <article>
            {document.sections.map((section, index) => (
              <section id={`legal-section-${index + 1}`} key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && (
                  <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
                )}
              </section>
            ))}
            <div className="koma-legal-document-end">
              <ShieldCheck size={22} aria-hidden="true" />
              <div>
                <strong>VERSÃO {document.version}</strong>
                <p>Alterações relevantes serão publicadas em nova versão e, quando necessário, exigirão novo aceite eletrônico.</p>
              </div>
            </div>
          </article>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}

export default function LegalPage() {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  const slug = pathname === '/legal' ? undefined : pathname.split('/')[2];
  return slug ? <LegalDocumentPage slug={slug} /> : <LegalCenter />;
}
