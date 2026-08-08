import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { HeroTabletScene } from '../product/HeroTabletScene';

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
      {/* Layer 1: Dark Green Solid Color Plane Right Side */}
      <div className="koma-hero-color-plane" aria-hidden="true" />

      {/* Layer 2 & 3: Asymmetrical 35-40% Copy / 60-65% Visual Dominance Grid */}
      <div className="koma-hero-grid">
        {/* Layer 2: Copy + Headline */}
        <motion.div
          className="koma-hero-content"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="koma-hero-headline" aria-label="O restaurante não para">
            <span className="koma-hero-line koma-hero-line--sm">O</span>
            <span className="koma-hero-line koma-hero-line--xl">RESTAURANTE</span>

            {/* Signature Green Line Axis passing behind product */}
            <div className="koma-hero-bar-wrap">
              <motion.span
                className="koma-hero-bar"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
                aria-hidden="true"
              />
            </div>

            <span className="koma-hero-line koma-hero-line--lg">NÃO PARA.</span>
          </h1>

          <motion.p
            className="koma-hero-sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
          >
            <span className="koma-hero-sub-bold">Seu sistema também não.</span>
            Do salão à cozinha, tudo no mesmo fluxo.
          </motion.p>

          <motion.div
            className="koma-hero-cta"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
          >
            <a href="#demonstracao" className="koma-btn koma-btn--primary">
              Solicitar demonstração
            </a>
          </motion.div>
        </motion.div>

        {/* Layer 3: Physical Tablet Product Object with Real PNG Overlay Frame */}
        <div className="koma-hero-device-container">
          <HeroTabletScene />
        </div>
      </div>

      {/* Numerated Bottom Module Strip */}
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
