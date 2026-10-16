import React from 'react';
import { getProductImageUrl, LOCAL_PRODUCT_PLACEHOLDER } from '../CardapioTypes';

/** A mesma imagem cadastrada em todas as vitrines, com fallback local. */
export default function CatalogProductImage({ image, alt = '', className }: {
  image?: string; alt?: string; className?: string;
}) {
  return <img src={getProductImageUrl(image || '')} alt={alt} className={className}
    loading="lazy" decoding="async" referrerPolicy="no-referrer"
    onError={event => {
      if (event.currentTarget.src !== LOCAL_PRODUCT_PLACEHOLDER) {
        event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
      }
    }} />;
}
