/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from "react";

interface CardapioCategoryNavProps {
  categories: string[];
  activeCategory: string;
  onSelectCategory: (category: string) => void;
}

export default function CardapioCategoryNav({
  categories,
  activeCategory,
  onSelectCategory
}: CardapioCategoryNavProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const getSlug = (name: string) =>
    name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');

  useEffect(() => {
    if (containerRef.current) {
      const sanitizedId = getSlug(activeCategory);
      const activeBtn = containerRef.current.querySelector(
        `#cat-btn-${sanitizedId}`
      ) as HTMLElement;
      if (activeBtn) {
        const container = containerRef.current;
        const containerWidth = container.clientWidth;
        const btnOffsetLeft = activeBtn.offsetLeft;
        const btnWidth = activeBtn.clientWidth;

        // Scroll the container horizontally to center the active button
        container.scrollTo({
          left: btnOffsetLeft - containerWidth / 2 + btnWidth / 2,
          behavior: "smooth"
        });
      }
    }
  }, [activeCategory]);

  return (
    <div
      className="sticky top-0 z-[35] w-full overflow-hidden border-b border-slate-200/10 bg-card-app/95 backdrop-blur-md py-3 px-4 shadow-xs"
      id="category-nav-container"
    >
      <div 
        ref={containerRef}
        className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth" 
        id="category-scroll"
      >
        {categories.map((category) => {
          const isActive = activeCategory === category;
          const sanitizedId = getSlug(category);
          return (
            <button
              key={category}
              onClick={() => onSelectCategory(category)}
              id={`cat-btn-${sanitizedId}`}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold tracking-wide transition-all duration-200 cursor-pointer ${
                isActive
                  ? "bg-primary text-white shadow-md shadow-primary/20 scale-[1.02]"
                  : "bg-slate-500/10 text-text-app/80 hover:bg-slate-500/20"
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
}
