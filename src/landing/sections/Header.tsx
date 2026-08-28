import React, { useState, useEffect } from 'react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../../brand/komaBrand';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { WhatsAppIcon } from '../components/WhatsAppIcon';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
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
          <a href={KOMA_LANDING_CONFIG.signupAnchor} className="koma-btn koma-btn--primary koma-btn--sm">
            Começar agora
          </a>
        </div>

        <button
          className={`koma-hamburger ${menuOpen ? 'koma-hamburger--open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <div
        className={`koma-mobile-menu ${menuOpen ? 'koma-mobile-menu--open' : ''}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Menu mobile">
          <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a>
          <a href="#duvidas" onClick={() => setMenuOpen(false)}>Dúvidas</a>
          <a href="#planos" onClick={() => setMenuOpen(false)}>Planos</a>
          <a
            href={KOMA_LANDING_CONFIG.signupAnchor}
            className="koma-btn koma-btn--primary"
            onClick={() => setMenuOpen(false)}
          >
            Começar agora
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
