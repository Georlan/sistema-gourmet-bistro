import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView, useMotionValueEvent, useScroll } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

type ActiveDevice = 'laptop' | 'tablet' | 'phone';

export function Ecosystem() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  const [scrollDevice, setScrollDevice] = useState<ActiveDevice>('laptop');
  const [hoverDevice, setHoverDevice] = useState<ActiveDevice | null>(null);
  const [isDesktopStory, setIsDesktopStory] = useState(false);
  const activeDevice = hoverDevice ?? scrollDevice;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1100px) and (hover: hover) and (prefers-reduced-motion: no-preference)');
    const update = () => setIsDesktopStory(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => () => {
    if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
  }, []);

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    if (!isDesktopStory) return;
    const nextDevice: ActiveDevice = progress < 0.34 ? 'laptop' : progress < 0.67 ? 'tablet' : 'phone';
    setScrollDevice((current) => current === nextDevice ? current : nextDevice);
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5

    if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.style.setProperty('--eco-shift-x', `${x * 8}px`);
      stage.style.setProperty('--eco-shift-y', `${y * 7}px`);
      stage.style.setProperty('--eco-rotate-x', `${-y * 2.5}deg`);
      stage.style.setProperty('--eco-rotate-y', `${x * 4}deg`);
    });
  };

  const handleMouseLeave = () => {
    const stage = stageRef.current;
    stage?.style.setProperty('--eco-shift-x', '0px');
    stage?.style.setProperty('--eco-shift-y', '0px');
    stage?.style.setProperty('--eco-rotate-x', '0deg');
    stage?.style.setProperty('--eco-rotate-y', '0deg');
    setHoverDevice(null);
  };

  const pose = (device: ActiveDevice) => {
    if (!isDesktopStory) return { x: 0, y: 0, scale: 1, opacity: 1 };

    const poses = {
      laptop: {
        laptop: { x: 0, y: 0, scale: 1, opacity: 1 },
        tablet: { x: -70, y: -8, scale: 0.84, opacity: 0.16 },
        phone: { x: -110, y: -14, scale: 0.74, opacity: 0.07 },
      },
      tablet: {
        laptop: { x: 105, y: 40, scale: 0.74, opacity: 0.08 },
        tablet: { x: -44, y: -20, scale: 1.08, opacity: 1 },
        phone: { x: -145, y: -8, scale: 0.78, opacity: 0.1 },
      },
      phone: {
        laptop: { x: 120, y: 55, scale: 0.68, opacity: 0.05 },
        tablet: { x: 110, y: 36, scale: 0.72, opacity: 0.08 },
        phone: { x: -205, y: -35, scale: 1.72, opacity: 1 },
      },
    } as const;

    return poses[device][activeDevice];
  };

  const laptopPose = pose('laptop');
  const tabletPose = pose('tablet');
  const phonePose = pose('phone');

  return (
    <section
      ref={sectionRef}
      className="koma-ecosystem-section"
      aria-label="Ecossistema"
      data-active-device={activeDevice}
    >
      <div className="koma-eco-sticky-stage">
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
            <button
              type="button"
              className={`koma-eco-func-item ${activeDevice === 'laptop' ? 'koma-eco-func-item--active' : ''}`}
              onMouseEnter={() => setHoverDevice('laptop')}
              onMouseLeave={() => setHoverDevice(null)}
              onFocus={() => setHoverDevice('laptop')}
              onBlur={() => setHoverDevice(null)}
              onClick={() => setScrollDevice('laptop')}
              aria-pressed={activeDevice === 'laptop'}
            >
              <span className="koma-eco-func-num">01 / CAIXA</span>
              <h3 className="koma-eco-func-title">NÚCLEO OPERACIONAL</h3>
              <p className="koma-eco-func-desc">Abertura de caixa, gestão financeira e controle central.</p>
            </button>

            <button
              type="button"
              className={`koma-eco-func-item ${activeDevice === 'tablet' ? 'koma-eco-func-item--active' : ''}`}
              onMouseEnter={() => setHoverDevice('tablet')}
              onMouseLeave={() => setHoverDevice(null)}
              onFocus={() => setHoverDevice('tablet')}
              onBlur={() => setHoverDevice(null)}
              onClick={() => setScrollDevice('tablet')}
              aria-pressed={activeDevice === 'tablet'}
            >
              <span className="koma-eco-func-num">02 / SALÃO</span>
              <h3 className="koma-eco-func-title">OPERAÇÃO EM MESAS</h3>
              <p className="koma-eco-func-desc">Atendimento ágil do garçom e mapa de mesas em tempo real.</p>
            </button>

            <button
              type="button"
              className={`koma-eco-func-item ${activeDevice === 'phone' ? 'koma-eco-func-item--active' : ''}`}
              onMouseEnter={() => setHoverDevice('phone')}
              onMouseLeave={() => setHoverDevice(null)}
              onFocus={() => setHoverDevice('phone')}
              onBlur={() => setHoverDevice(null)}
              onClick={() => setScrollDevice('phone')}
              aria-pressed={activeDevice === 'phone'}
            >
              <span className="koma-eco-func-num">03 / CARDÁPIO</span>
              <h3 className="koma-eco-func-title">EXPERIÊNCIA MÓVEL</h3>
              <p className="koma-eco-func-desc">Cardápio QR Code direto no celular do cliente para pedidos sem fila.</p>
            </button>
          </div>

          <div className="koma-eco-scroll-cue" aria-hidden="true">
            <span />
            ROLE PARA PERCORRER AS TELAS
          </div>
        </motion.div>

        {/* Right Column: Cohesive 3D Spatial Scene with Unified Parallax */}
        <div
          ref={stageRef}
          className="koma-eco-cluster-stage"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <div className="koma-eco-stage-index" aria-hidden="true">
            <span>KÔMA / ECOSSISTEMA</span>
            <span>03 SUPERFÍCIES / 01 OPERAÇÃO</span>
          </div>
          {/* Background Ambient Parallax Surface */}
          <div
            className="koma-eco-stage-bg-surface"
            aria-hidden="true"
          />

          {/* LEVEL 1: Dominant Frontal Laptop (Caixa / PDV) */}
          <div
            className={`koma-eco-device-laptop ${activeDevice === 'laptop' ? 'koma-eco-device--hovered' : ''}`}
            onMouseEnter={() => setHoverDevice('laptop')}
            onMouseLeave={() => setHoverDevice(null)}
            style={{
              opacity: laptopPose.opacity,
              transform: `perspective(1200px) rotateY(calc(-5deg + var(--eco-rotate-y))) rotateX(calc(2deg + var(--eco-rotate-x))) rotateZ(-0.5deg) translate3d(calc(${laptopPose.x}px + var(--eco-shift-x)), calc(${laptopPose.y}px + var(--eco-shift-y)), 0px) scale(${laptopPose.scale})`,
              transition: 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease, filter 0.25s ease',
              zIndex: activeDevice === 'laptop' ? 6 : 1,
            }}
          >
            <FrontalLaptopFrame view="pdv" />
          </div>

          {/* LEVEL 2: Tablet (Salão / Mesas) - fixed in front of the laptop */}
          <div
            className={`koma-eco-device-tablet ${activeDevice === 'tablet' ? 'koma-eco-device--hovered' : ''}`}
            onMouseEnter={() => setHoverDevice('tablet')}
            onMouseLeave={() => setHoverDevice(null)}
            style={{
              opacity: tabletPose.opacity,
              transform: `perspective(1000px) rotateY(calc(-9deg + var(--eco-rotate-y))) rotateX(calc(3deg + var(--eco-rotate-x))) rotateZ(2deg) translate3d(calc(${tabletPose.x}px + var(--eco-shift-x)), calc(${tabletPose.y}px + var(--eco-shift-y)), 0px) scale(${tabletPose.scale})`,
              transition: 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease, filter 0.25s ease',
              zIndex: activeDevice === 'tablet' ? 6 : 2,
            }}
          >
            <TabletFrame view="mesas" />
          </div>

          {/* LEVEL 3: Smartphone (Cardápio Mobile) */}
          <div
            className={`koma-eco-device-phone ${activeDevice === 'phone' ? 'koma-eco-device--hovered' : ''}`}
            onMouseEnter={() => setHoverDevice('phone')}
            onMouseLeave={() => setHoverDevice(null)}
            style={{
              opacity: phonePose.opacity,
              transform: `perspective(800px) rotateY(calc(-6deg + var(--eco-rotate-y))) rotateX(calc(2deg + var(--eco-rotate-x))) rotateZ(-1.5deg) translate3d(calc(${phonePose.x}px + var(--eco-shift-x)), calc(${phonePose.y}px + var(--eco-shift-y)), 0px) scale(${phonePose.scale})`,
              transition: 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease, filter 0.25s ease',
              zIndex: activeDevice === 'phone' ? 6 : 3,
            }}
          >
            <PhoneFrame />
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
