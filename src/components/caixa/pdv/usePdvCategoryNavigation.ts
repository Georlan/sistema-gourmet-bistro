import React, { useCallback, useEffect, useRef, useState } from 'react';

/** DOM observers live with the lazy view, after its elements have mounted. */
export function usePdvCategoryNavigation({
  activeSubTab,
  balcaoMobileView,
  pdvCategories,
}: {
  activeSubTab: string;
  balcaoMobileView: string;
  pdvCategories: readonly unknown[];
}) {
  const [pdvCategoryScrollState, setPdvCategoryScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const pdvCategoryScrollRef = useRef<HTMLDivElement>(null);

  const pdvCategoryDragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });

  const pdvCategorySuppressClickRef = useRef(false);

  const updatePdvCategoryScrollState = useCallback(() => {
    const element = pdvCategoryScrollRef.current;
    if (!element) return;
    const maxScrollLeft = Math.max(element.scrollWidth - element.clientWidth, 0);
    setPdvCategoryScrollState({
      hasOverflow: maxScrollLeft > 2,
      canScrollLeft: element.scrollLeft > 2,
      canScrollRight: element.scrollLeft < maxScrollLeft - 2,
    });
  }, []);

  const scrollPdvCategories = useCallback((direction: -1 | 1) => {
    const element = pdvCategoryScrollRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(element.clientWidth * 0.72, 240),
      behavior: 'smooth',
    });
  }, []);

  const handlePdvCategoryWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const element = pdvCategoryScrollRef.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const canMove = delta < 0 ? element.scrollLeft > 0 : element.scrollLeft < maxScrollLeft;
    if (!canMove) return;
    event.preventDefault();
    element.scrollLeft += delta;
  }, []);

  const handlePdvCategoryPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const element = pdvCategoryScrollRef.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    pdvCategoryDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  }, []);

  const handlePdvCategoryPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = pdvCategoryScrollRef.current;
    const drag = pdvCategoryDragRef.current;
    if (!element || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.moved = true;
    if (!drag.moved) return;
    element.scrollLeft = drag.startScrollLeft - distance;
  }, []);

  const finishPdvCategoryDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = pdvCategoryScrollRef.current;
    const drag = pdvCategoryDragRef.current;
    if (!element || drag.pointerId !== event.pointerId) return;
    pdvCategorySuppressClickRef.current = drag.moved;
    if (drag.moved) {
      window.setTimeout(() => {
        pdvCategorySuppressClickRef.current = false;
      }, 0);
    }
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    pdvCategoryDragRef.current.pointerId = -1;
  }, []);

  useEffect(() => {
    updatePdvCategoryScrollState();
    const element = pdvCategoryScrollRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updatePdvCategoryScrollState);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [activeSubTab, balcaoMobileView, pdvCategories, updatePdvCategoryScrollState]);
  return {
    pdvCategoryScrollRef,
    pdvCategorySuppressClickRef,
    pdvCategoryScrollState,
    updatePdvCategoryScrollState,
    scrollPdvCategories,
    handlePdvCategoryWheel,
    handlePdvCategoryPointerDown,
    handlePdvCategoryPointerMove,
    finishPdvCategoryDrag,
  };
}
