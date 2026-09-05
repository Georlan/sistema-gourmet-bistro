import React, { useState, useEffect, useRef } from 'react';
import { useLeadCapture } from '../components/LeadCaptureProvider';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../../brand/komaBrand';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { WhatsAppIcon } from '../components/WhatsAppIcon';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openDemo = useLeadCapture();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    const main = toggleRef.current?.closest('.koma-landing')?.querySelector('main');
    const wasInert = main?.inert ?? false;
    if (main) main.inert = true;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1025px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      document.body.style.overflow = previous;
      if (main) main.inert = wasInert;
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [menuOpen]);

  return (
    <>
      <header
        className={`koma-header ${scrolled ? 'koma-header--scrolled' : ''}`}
        role="banner"
      >
        <a href="/landing" className="koma-header-logo" aria-label="Kôma, início">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="Kôma" />
        </a>

        <nav className="koma-header-nav" aria-label="Navegação principal">
          <a href="#como-funciona" className="koma-header-link">Como funciona</a>
          <a href="#duvidas" className="koma-header-link">Dúvidas</a>
          <a href="#planos" className="koma-header-link">Planos</a>
        </nav>

        <div className="koma-header-actions">
          <a
            href={KOMA_LANDING_CONFIG.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="koma-header-link koma-header-link--whatsapp"
          >
            <WhatsAppIcon />
            Falar no WhatsApp
          </a>
          <a href="/contratar/pocket" className="koma-btn koma-btn--primary koma-btn--sm">
            Começar no Pocket
          </a>
        </div>

        <a href="/contratar/pocket" className="koma-mobile-demo koma-btn koma-btn--primary" onClick={() => setMenuOpen(false)}>Começar</a>
        <button
          ref={toggleRef}
          type="button"
          className={`koma-hamburger ${menuOpen ? 'koma-hamburger--open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
          aria-controls="koma-mobile-navigation"
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <div
        id="koma-mobile-navigation"
        className={`koma-mobile-menu ${menuOpen ? 'koma-mobile-menu--open' : ''}`}
        aria-hidden={!menuOpen}
        inert={!menuOpen}
      >
        <nav aria-label="Menu mobile">
          <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a>
          <a href="#duvidas" onClick={() => setMenuOpen(false)}>Dúvidas</a>
          <a href="#planos" onClick={() => setMenuOpen(false)}>Planos</a>
          <button
            type="button"
            className="koma-btn koma-btn--outline"
            onClick={() => { setMenuOpen(false); toggleRef.current?.focus(); openDemo(); }}
          >
            Ver o Kôma em ação
          </button>
          <a
            href="/contratar/pocket"
            className="koma-btn koma-btn--primary"
            onClick={() => setMenuOpen(false)}
          >
            Começar no Pocket
          </a>
          <a
            href={KOMA_LANDING_CONFIG.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="koma-btn koma-btn--outline"
            onClick={() => setMenuOpen(false)}
            style={{ marginTop: '0.5rem' }}
          >
            <WhatsAppIcon />
            Falar no WhatsApp
          </a>
        </nav>
      </div>
    </>
  );
}
