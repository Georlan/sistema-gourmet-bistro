import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';

export function ProductShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.2 });

  return (
    <section
      ref={sectionRef}
      className="koma-section koma-section--white"
      id="produto"
      aria-label="Produto"
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="koma-section-title">Do salão<br />à cozinha.</h2>
        <p className="koma-section-sub">Sem papel. Sem espera.</p>
      </motion.div>

      <motion.div
        className="koma-showcase-screen"
        initial={{ opacity: 0, y: 60, scale: 0.97 }}
        animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      >
        <div className="koma-showcase-interface">
          <div className="koma-showcase-topbar">
            <div className="koma-showcase-logo-placeholder" />
            <div className="koma-showcase-nav-items">
              <div className="koma-showcase-nav-item koma-showcase-nav-item--active" />
              <div className="koma-showcase-nav-item" />
              <div className="koma-showcase-nav-item" />
              <div className="koma-showcase-nav-item" />
            </div>
          </div>
          <div className="koma-showcase-body">
            <div className="koma-showcase-sidebar-lg">
              <div className="koma-showcase-sidebar-item koma-showcase-sidebar-item--active" />
              <div className="koma-showcase-sidebar-item" />
              <div className="koma-showcase-sidebar-item" />
              <div className="koma-showcase-sidebar-item" />
              <div className="koma-showcase-sidebar-item" />
              <div className="koma-showcase-sidebar-item" />
            </div>
            <div className="koma-showcase-grid-lg">
              {Array.from({ length: 20 }, (_, i) => {
                const states = [
                  'empty', 'active', 'empty', 'occupied', 'empty',
                  'active', 'empty', 'empty', 'active', 'empty',
                  'occupied', 'empty', 'active', 'empty', 'empty',
                  'empty', 'occupied', 'active', 'empty', 'empty',
                ];
                return (
                  <div
                    key={i}
                    className={`koma-showcase-card koma-showcase-card--${states[i]}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
