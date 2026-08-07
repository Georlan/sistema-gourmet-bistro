import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';

const STAGES = [
  { id: 'pedido', label: 'PEDIDO' },
  { id: 'salao', label: 'SALÃO' },
  { id: 'cozinha', label: 'COZINHA' },
  { id: 'caixa', label: 'CAIXA' },
  { id: 'entrega', label: 'ENTREGA' },
] as const;

const BG_WORDS = 'SALÃO PEDIDO COZINHA CAIXA ENTREGA ';

export function OperationFlow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const lineFill = useTransform(scrollYProgress, [0.05, 0.95], ['0%', '100%']);
  const dotPosition = useTransform(scrollYProgress, [0.05, 0.95], ['0%', '100%']);

  // Pre-create opacity values for each stage
  const stageOpacity0 = useTransform(scrollYProgress, [0, 0.05, 0.15, 0.25], [0.3, 1, 1, 0.3]);
  const stageOpacity1 = useTransform(scrollYProgress, [0.15, 0.25, 0.35, 0.45], [0.3, 1, 1, 0.3]);
  const stageOpacity2 = useTransform(scrollYProgress, [0.35, 0.45, 0.55, 0.65], [0.3, 1, 1, 0.3]);
  const stageOpacity3 = useTransform(scrollYProgress, [0.55, 0.65, 0.75, 0.85], [0.3, 1, 1, 0.3]);
  const stageOpacity4 = useTransform(scrollYProgress, [0.75, 0.85, 0.95, 1.0], [0.3, 1, 1, 1]);
  const stageOpacities = [stageOpacity0, stageOpacity1, stageOpacity2, stageOpacity3, stageOpacity4];

  const stageScale0 = useTransform(scrollYProgress, [0, 0.05, 0.15, 0.25], [1, 1.15, 1.15, 1]);
  const stageScale1 = useTransform(scrollYProgress, [0.15, 0.25, 0.35, 0.45], [1, 1.15, 1.15, 1]);
  const stageScale2 = useTransform(scrollYProgress, [0.35, 0.45, 0.55, 0.65], [1, 1.15, 1.15, 1]);
  const stageScale3 = useTransform(scrollYProgress, [0.55, 0.65, 0.75, 0.85], [1, 1.15, 1.15, 1]);
  const stageScale4 = useTransform(scrollYProgress, [0.75, 0.85, 0.95, 1.0], [1, 1.15, 1.15, 1.15]);
  const stageScales = [stageScale0, stageScale1, stageScale2, stageScale3, stageScale4];

  return (
    <div ref={containerRef} className="koma-flow" id="solucoes">
      <div className="koma-flow-sticky">
        {/* Background word pattern */}
        <div className="koma-flow-pattern" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>{BG_WORDS.repeat(4)}</div>
          ))}
        </div>

        {/* Title */}
        <h2 className="koma-flow-title">
          O pedido entra.<br />
          A operação acompanha.
        </h2>

        {/* The line */}
        <div className="koma-flow-line" aria-hidden="true">
          <motion.div className="koma-flow-line-fill" style={{ width: lineFill }} />
          <motion.div className="koma-flow-dot" style={{ left: dotPosition }} />
          {STAGES.map((stage, i) => (
            <div
              key={stage.id}
              className="koma-flow-marker"
              style={{ left: `${(i / (STAGES.length - 1)) * 100}%` }}
            />
          ))}
        </div>

        {/* Stage labels */}
        <div className="koma-flow-stages">
          {STAGES.map((stage, i) => (
            <motion.div
              key={stage.id}
              className="koma-flow-stage"
              style={{
                opacity: stageOpacities[i],
                scale: stageScales[i],
              }}
            >
              <span className="koma-flow-stage-label">{stage.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
