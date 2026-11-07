import React from 'react';
import { getProductImageUrl, LOCAL_PRODUCT_PLACEHOLDER } from '../CardapioTypes';

/** A mesma imagem cadastrada em todas as vitrines, com fallback local. */
export default function CatalogProductImage({
  image,
  alt = '',
  className,
  priority = false,
  width,
  height,
  sizes,
}: {
  image?: string;
  alt?: string;
  className?: string;
  priority?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
}) {
  return (
    <img
      src={getProductImageUrl(image || '')}
      alt={alt}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      width={width}
      height={height}
      sizes={sizes}
      referrerPolicy="no-referrer"
      onError={event => {
        if (event.currentTarget.src !== LOCAL_PRODUCT_PLACEHOLDER) {
          event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
        }
      }}
    />
  );
}

