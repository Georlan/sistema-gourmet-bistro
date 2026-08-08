import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { HeroTabletScene } from '../product/HeroTabletScene';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

const HERO_STRIP_ITEMS = [
  { num: '01', name: 'PDV BALCÃO' },
  { num: '02', name: 'GESTÃO DE MESAS' },
  { num: '03', name: 'KDS COZINHA' },
  { num: '04', name: 'CARDÁPIO QR' },
  { num: '05', name: 'IMPRESSÃO AUTOMÁTICA' },
];

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} className="koma-hero" aria-label="Hero">
      <div className="koma-hero-color-plane" aria-hidden="true" />

      <div className="koma-hero-grid">
        <motion.div
          className="koma-hero-content"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="koma-hero-headline" aria-label="O restaurante não para">
            <span className="koma-hero-line koma-hero-line--sm">O</span>
            <span className="koma-hero-line koma-hero-line--xl">RESTAURANTE</span>
            <span className="koma-hero-bar-wrap" aria-hidden="true">
              <motion.span
                className="koma-hero-bar"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.75, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
            <span className="koma-hero-line koma-hero-line--lg koma-hero-line--accent">NÃO PARA.</span>
          </h1>

          <motion.p
            className="koma-hero-sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
          >
            <span className="koma-hero-sub-bold">Seu sistema também não.</span>
            Salão, pedidos, cozinha e caixa no mesmo fluxo.
          </motion.p>

          <motion.div
            className="koma-hero-cta-group"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
          >
            <a href={KOMA_LANDING_CONFIG.demoAnchor} className="koma-btn koma-btn--primary">
              Solicitar demonstração
            </a>
            <a
              href={KOMA_LANDING_CONFIG.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="koma-hero-whatsapp-link"
            >
              Falar com um especialista <span aria-hidden="true">↗</span>
            </a>
          </motion.div>
        </motion.div>

        <div className="koma-hero-device-container">
          <HeroTabletScene className="koma-hero-device-frame" />
        </div>
      </div>

      <motion.div
        className="koma-hero-strip"
        role="list"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.65 }}
      >
        {HERO_STRIP_ITEMS.map((item) => (
          <div key={item.num} className="koma-hero-strip-item" role="listitem">
            <span className="koma-hero-strip-num">{item.num}</span>
            <span className="koma-hero-strip-name">{item.name}</span>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
