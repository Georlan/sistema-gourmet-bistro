// Local visual QA only. This entry is not part of the production build.
import React from 'react';
import { createRoot } from 'react-dom/client';
import CardapioPage from '../../src/cardapio/CardapioPage';
import '../../src/index.css';
import '../../src/cardapio/cardapioTone.css';
import '../../src/cardapio/cardapioPublic.css';

const deliveryScenario = new URLSearchParams(location.search).get('entrega');

// No request is forwarded to a real API, including OTP, coupons and order submission.
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.pathname === '/api/cardapio-digital/public' && method === 'GET') {
    const id = Number(url.searchParams.get('restaurante_id')) === 902 ? 902 : 901;
    return Response.json({
      restaurante: {
        id,
        nome: id === 901 ? 'Loja A · teste local' : 'Loja B · teste local',
        subtitulo: 'Dados fictícios. Nenhum pedido será enviado.',
        endereco: 'Endereço fictício para teste de retirada',
        logo_url: '', banner_url: '',
        status_override: 'Forçado Aberto',
        formas_pagamento_aceitas: ['Pix', 'Dinheiro'],
        ...(deliveryScenario ? {
          taxa_entrega_padrao: id === 901 ? 8 : 12,
          pedido_minimo: 30,
          frete_gratis_valor: deliveryScenario === 'gratis' ? 25 : 75,
          tabela_taxas_bairros: deliveryScenario === 'fixa' ? [] : [
            { bairro: 'Centro', taxa: id === 901 ? 5 : 9 },
            { bairro: 'Bairro com nome bastante longo para testar no celular', taxa: 11 },
            { bairro: 'Retiro', taxa: 0 },
          ],
        } : {}),
      },
      categorias: [{ id: 'lanches', nome: 'Lanches' }],
      produtos: Array.from({ length: 8 }, (_, index) => ({
        id: `${id}-produto-${index + 1}`,
        nome: `Lanche de teste ${index + 1}`,
        descricao: 'Produto fictício para validar a sacola em diferentes tamanhos de tela.',
        preco: (id === 901 ? 25 : 30) + index,
        categoria_id: 'lanches',
        imagem_url: '',
      })),
    });
  }
  return Response.json({ detail: 'Operação bloqueada nesta página de teste local.' }, { status: 503 });
};

createRoot(document.getElementById('root')!).render(<CardapioPage />);
