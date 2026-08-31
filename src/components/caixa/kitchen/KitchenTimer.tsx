import React, { useEffect, useState } from 'react';

import { Clock } from 'lucide-react';

export const KitchenTimer: React.FC<{ itemTimestamp?: string; status: string }> = ({ itemTimestamp, status }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    if (!itemTimestamp || status !== 'preparando') return;

    const calculateElapsed = () => {
      const startTime = new Date(itemTimestamp).getTime();
      if (isNaN(startTime)) return;
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - startTime) / 1000));
      setElapsedSeconds(diff);
    };

    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [itemTimestamp, status]);

  if (status === 'pronto') {
    return (
      <span
        className={"px-2 py-0.5 text-[8px] font-bold rounded font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"}
      >
        ✓ PRONTO
      </span>
    );
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  let colorClasses = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  let label = 'Em preparo';

  if (minutes >= 15) {
    colorClasses = 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/40 animate-pulse font-extrabold';
    label = 'Atrasado!';
  } else if (minutes >= 10) {
    colorClasses = 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30 font-bold';
    label = 'Atenção';
  }

  return (
    <div
      className={`px-2 py-0.5 text-[8px] font-mono font-bold rounded border flex items-center gap-1 ${colorClasses}`}
    >
      <Clock size={10} className="shrink-0" />
      <span>
        {formattedTime} ({label})
      </span>
    </div>
  );
};
