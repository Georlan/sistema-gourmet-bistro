/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";

interface CardapioCategoryNavProps {
  categories: string[];
  activeCategory: string;
  onSelectCategory: (category: string) => void;
}

const getSafeDomId = (name: string) =>
  name
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function CardapioCategoryNav({
  categories,
  activeCategory,
  onSelectCategory,
}: CardapioCategoryNavProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const container = containerRef.current;
    const activeBtn = buttonRefs.current.get(activeCategory);
    if (!container || !activeBtn) return;

    container.scrollTo({
      left: activeBtn.offsetLeft - container.clientWidth / 2 + activeBtn.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeCategory]);

  if (categories.length === 0) return null;

  return (
    <nav
      className="cardapio-category-nav"
      id="category-nav-container"
      aria-label="Categorias do cardápio"
    >
      <div
        ref={containerRef}
        className="cardapio-category-scroll no-scrollbar"
        id="category-scroll"
      >
        {categories.map((category) => {
          const isActive = activeCategory === category;
          return (
            <button
              key={category}
              ref={(node) => {
                if (node) buttonRefs.current.set(category, node);
                else buttonRefs.current.delete(category);
              }}
              type="button"
              onClick={() => onSelectCategory(category)}
              id={`cat-btn-${getSafeDomId(category)}`}
              className={`cardapio-category-chip ${isActive ? "is-active" : ""}`}
              aria-current={isActive ? "true" : undefined}
            >
              {category}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
