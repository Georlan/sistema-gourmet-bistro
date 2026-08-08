import React, { useRef, useState } from 'react';
import { motion, useInView } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

export function Ecosystem() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 });
  };

  return (
    <section ref={sectionRef} className="koma-ecosystem-section" aria-label="Ecossistema">
      <div className="koma-eco-grid-container">
        {/* Left Column: Editorial Headline, Tag & Functional Labels */}
        <motion.div
          className="koma-eco-editorial-col"
          initial={{ opacity: 0, x: -30 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="koma-eco-tag">04 / ECOSSISTEMA</span>

          <h2 className="koma-eco-title">
            UMA OPERAÇÃO.<br />
            EM QUALQUER TELA.
          </h2>

          <p className="koma-eco-subtitle">
            Caixa, salão e cliente conectados pelo KÔMA em uma única base operacional.
          </p>

          <div className="koma-eco-functional-list">
            <div className="koma-eco-func-item">
              <span className="koma-eco-func-num">01 / CAIXA</span>
              <h3 className="koma-eco-func-title">NÚCLEO OPERACIONAL</h3>
              <p className="koma-eco-func-desc">Abertura de caixa, gestão financeira e controle central.</p>
            </div>

            <div className="koma-eco-func-item">
              <span className="koma-eco-func-num">02 / SALÃO</span>
              <h3 className="koma-eco-func-title">OPERAÇÃO EM MESAS</h3>
              <p className="koma-eco-func-desc">Atendimento ágil do garçom e mapa de mesas em tempo real.</p>
            </div>

            <div className="koma-eco-func-item">
              <span className="koma-eco-func-num">03 / CARDÁPIO</span>
              <h3 className="koma-eco-func-title">EXPERIÊNCIA MÓVEL</h3>
              <p className="koma-eco-func-desc">Cardápio QR Code direto no celular do cliente para pedidos sem fila.</p>
            </div>
          </div>
        </motion.div>

        {/* Right Column: Cohesive 3-Device Cluster Scene with Parallax */}
        <div
          ref={stageRef}
          className="koma-eco-cluster-stage"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Background Ambient Surface Shape */}
          <div className="koma-eco-stage-bg-surface" aria-hidden="true" />

          {/* LEVEL 1: Dominant Frontal Laptop (Caixa / PDV) */}
          <motion.div
            className="koma-eco-device-laptop"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(1200px) rotateY(${-3 + mousePos.x * 3}deg) rotateX(${1 - mousePos.y * 2}deg) translate3d(${mousePos.x * 3}px, ${mousePos.y * 3}px, 0px)`,
              transition: 'transform 0.2s ease-out',
            }}
          >
            <FrontalLaptopFrame view="pdv" />
          </motion.div>

          {/* LEVEL 2: Tablet (Salão / Mesas) overlapping lower right corner of Laptop */}
          <motion.div
            className="koma-eco-device-tablet"
            initial={{ opacity: 0, y: 55, x: 30 }}
            animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(1000px) rotateY(${-7 + mousePos.x * 4}deg) rotateZ(2deg) translate3d(${mousePos.x * 6}px, ${mousePos.y * 5}px, 0px)`,
              transition: 'transform 0.2s ease-out',
            }}
          >
            <TabletFrame view="mesas" />
          </motion.div>

          {/* LEVEL 3: Smartphone (Cardápio Mobile) overlapping front right corner of Tablet */}
          <motion.div
            className="koma-eco-device-phone"
            initial={{ opacity: 0, y: 70, x: 40 }}
            animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(800px) rotateY(${-4 + mousePos.x * 5}deg) rotateZ(-2deg) translate3d(${mousePos.x * 10}px, ${mousePos.y * 8}px, 0px)`,
              transition: 'transform 0.2s ease-out',
            }}
          >
            <PhoneFrame />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
