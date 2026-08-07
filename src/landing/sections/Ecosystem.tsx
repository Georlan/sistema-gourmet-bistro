import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';

function MonitorScreen() {
  return (
    <div className="koma-eco-screen koma-eco-screen--monitor">
      <div className="koma-eco-topbar" />
      <div className="koma-eco-grid koma-eco-grid--wide">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className={`koma-eco-card ${
              i % 3 === 0 ? 'koma-eco-card--green' : i % 4 === 0 ? 'koma-eco-card--amber' : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function TabletScreen() {
  return (
    <div className="koma-eco-screen koma-eco-screen--tablet">
      <div className="koma-eco-topbar" />
      <div className="koma-eco-grid koma-eco-grid--medium">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className={`koma-eco-card ${i % 2 === 0 ? 'koma-eco-card--green' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

function PhoneScreen() {
  return (
    <div className="koma-eco-screen koma-eco-screen--phone">
      <div className="koma-eco-topbar" />
      <div className="koma-eco-list">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="koma-eco-list-item" />
        ))}
      </div>
    </div>
  );
}

export function Ecosystem() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });

  return (
    <section
      ref={ref}
      className="koma-section koma-section--dark"
      aria-label="Ecossistema"
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="koma-section-title">
          Tudo onde<br />precisa estar.
        </h2>
        <p className="koma-section-sub">
          PDV. Mesas. Cozinha. Cardápio digital. Delivery. Impressão.
        </p>
      </motion.div>

      <div className="koma-ecosystem-devices">
        <motion.div
          className="koma-ecosystem-monitor"
          initial={{ opacity: 0, y: 60 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          <div className="koma-eco-device koma-eco-device--monitor">
            <MonitorScreen />
          </div>
          <span className="koma-eco-label">Caixa</span>
        </motion.div>

        <motion.div
          className="koma-ecosystem-tablet"
          initial={{ opacity: 0, y: 80 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
        >
          <div className="koma-eco-device koma-eco-device--tablet">
            <TabletScreen />
          </div>
          <span className="koma-eco-label">Garçom</span>
        </motion.div>

        <motion.div
          className="koma-ecosystem-phone"
          initial={{ opacity: 0, y: 100 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
        >
          <div className="koma-eco-device koma-eco-device--phone">
            <PhoneScreen />
          </div>
          <span className="koma-eco-label">Cardápio</span>
        </motion.div>
      </div>
    </section>
  );
}
