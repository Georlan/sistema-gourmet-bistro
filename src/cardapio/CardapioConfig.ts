/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrandConfig, Product } from "./CardapioTypes";

export const STORE_CONFIG = {
  name: "Kôma Burger & Grelhados",
  colors: {
    primary: "#00b894", // Verde menta vibrante do sistema Kôma
    background: "#090a0f", // Fundo super escuro (Slate-Black)
    secondary: "#121420", // Card de fundo
    text: "#ffffff", // Texto branco
    card: "#121420", // Card de fundo
    accent: "#00b894" // Destaques em verde menta
  },
  categories: ["Destaques", "Hambúrgueres", "Acompanhamentos", "Bebidas", "Sobremesas"],
  products: [
    {
      id: "p1",
      name: "001 - Hambúrguer Tradicional",
      description: "Hambúrguer bovino 120g, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).",
      price: 19.00,
      image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=600",
      category: "Destaques",
      isAvailable: true,
      modifiers: [
        {
          id: "mod-ponto",
          title: "Escolha o ponto da carne",
          required: true,
          maxSelection: 1,
          options: [
            { id: "opt-ponto-1", name: "Ao ponto", extraPrice: 0 },
            { id: "opt-ponto-2", name: "Bem passado", extraPrice: 0 },
            { id: "opt-ponto-3", name: "Mal passado", extraPrice: 0 }
          ]
        },
        {
          id: "mod-salada",
          title: "Opção de salada",
          required: false,
          maxSelection: 1,
          options: [
            { id: "opt-sal-1", name: "Com salada completa", extraPrice: 0 },
            { id: "opt-sal-2", name: "Sem salada", extraPrice: 0 }
          ]
        }
      ]
    },
    {
      id: "p2",
      name: "002 - Cheese Burguer",
      description: "Hambúrguer bovino 120g, queijo coalho, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).",
      price: 22.00,
      image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=600",
      category: "Hambúrgueres",
      isAvailable: true,
      modifiers: [
        {
          id: "mod-adicionais",
          title: "Deseja adicionais?",
          required: false,
          maxSelection: 3,
          options: [
            { id: "opt-add-bacon", name: "Bacon Crocante Extra", extraPrice: 4.50 },
            { id: "opt-add-queijo", name: "Cheddar Extra", extraPrice: 3.50 }
          ]
        }
      ]
    },
    {
      id: "p3",
      name: "003 - Cheese Bacon",
      description: "Hambúrguer bovino 120g, queijo coalho, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).",
      price: 25.00,
      image: "https://images.unsplash.com/photo-1553979459-d2229ba7433b?auto=format&fit=crop&q=80&w=600",
      category: "Destaques",
      isAvailable: true,
      modifiers: [
        {
          id: "mod-molho",
          title: "Escolha o molho extra",
          required: false,
          maxSelection: 1,
          options: [
            { id: "opt-molho-alho", name: "Molho de Alho extra", extraPrice: 2.00 },
            { id: "opt-molho-barbecue", name: "Molho Barbecue", extraPrice: 2.00 }
          ]
        }
      ]
    },
    {
      id: "p4",
      name: "004 - Cheese Egg",
      description: "Hambúrguer bovino 120g, queijo coalho, ovo, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).",
      price: 25.00,
      image: "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&q=80&w=600",
      category: "Hambúrgueres",
      isAvailable: true
    },
    {
      id: "p5",
      name: "005 - Duplo Burguer",
      description: "2 Hambúrgueres bovinos 120g, queijo cheddar, bacon e molho de alho no pão brioche. (Salada opcional).",
      price: 29.00,
      image: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&q=80&w=600",
      category: "Destaques",
      isAvailable: true
    },
    {
      id: "p6",
      name: "006 - Burguer Pôr do Sol",
      description: "2 Hambúrgueres bovinos 120g, queijo coalho, ovo, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).",
      price: 34.00,
      image: "https://images.unsplash.com/photo-1521305916504-4a1121188589?auto=format&fit=crop&q=80&w=600",
      category: "Hambúrgueres",
      isAvailable: true
    },
    {
      id: "p7",
      name: "007 - Cheese Cupim",
      description: "Cupim desfiado 120g, queijo coalho, geleia de pimenta e mel no pão brioche. (Salada opcional).",
      price: 33.00,
      image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=600",
      category: "Hambúrgueres",
      isAvailable: true
    },
    {
      id: "p8",
      name: "008 - Hambúrguer Tropical",
      description: "Hambúrguer bovino 120g, cream cheese, abacaxi grelhado, bacon, molho barbecue e molho de alho no pão brioche.",
      price: 28.00,
      image: "https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?auto=format&fit=crop&q=80&w=600",
      category: "Hambúrgueres",
      isAvailable: true
    },
    {
      id: "b4",
      name: "Batata Frita Rústica",
      description: "Batatas rústicas fritas com casca, temperadas com sal e páprica defumada. Acompanha maionese da casa.",
      price: 15.00,
      image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&q=80&w=600",
      category: "Acompanhamentos",
      isAvailable: true
    },
    {
      id: "b6",
      name: "Refrigerante em Lata",
      description: "Coca-Cola Original, Coca Zero, Guaraná Antarctica ou Sprite (Lata 350ml). Selecione a sua preferência.",
      price: 6.50,
      image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=600",
      category: "Bebidas",
      isAvailable: true
    },
    {
      id: "b8",
      name: "Brownie Quente com Sorvete",
      description: "Brownie de chocolate belga bem molhadinho, servido quente com uma bola de sorvete de baunilha e calda de chocolate.",
      price: 18.90,
      image: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&q=80&w=600",
      category: "Sobremesas",
      isAvailable: true
    }
  ],
  socials: [
    { platform: "instagram", url: "https://instagram.com/koma.pdv", active: true },
    { platform: "facebook", url: "https://facebook.com/koma.pdv", active: true },
    { platform: "tiktok", url: "https://tiktok.com/@koma.pdv", active: false },
    { platform: "website", url: "https://koma.delivery", active: true }
  ],
  about: "Desenvolvido em perfeita sincronia com o Sistema Kôma PDV, o Kôma Burger combina tecnologia inteligente de gestão de cardápios com a paixão por hambúrgueres artesanais de verdade. Cada produto é enviado instantaneamente para a produção no painel da cozinha, reduzindo tempo de espera e otimizando cada atendimento.",
  paymentMethods: [
    { type: "Cartão de Crédito", accepted: ["Visa", "Mastercard", "Elo", "American Express"] },
    { type: "Cartão de Débito", accepted: ["Visa Electron", "Maestro", "Elo Débito"] },
    { type: "Refeição / Voucher", accepted: ["Sodexo", "Ticket Restaurante", "Alelo", "VR Refeição"] },
    { type: "Pix", accepted: ["Pix Instantâneo (QR Code ou Chave Copia e Cola)"] }
  ],
  operatingHours: [
    { days: "Segunda a Quinta", hours: "18:00 às 23:00" },
    { days: "Sexta e Sábado", hours: "18:00 às 00:30" },
    { days: "Domingo e Feriados", hours: "17:30 às 23:30" }
  ],
  googleMapsUrl: "https://maps.google.com/?q=Av.+Paulista,+1000+-+Bela+Vista,+S%C3%A3o+Paulo+-+SP"
};

export const whitelabelBrands: Record<string, BrandConfig> = {
  burger: {
    id: "burger",
    name: STORE_CONFIG.name,
    slogan: "Sincronizado com o Sistema Kôma PDV",
    logo: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=200&h=200",
    bannerImage: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=1200&h=400",
    phone: "5511999999999",
    address: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP",
    colors: STORE_CONFIG.colors,
    categories: STORE_CONFIG.categories,
    products: STORE_CONFIG.products as Product[],
    socials: STORE_CONFIG.socials,
    about: STORE_CONFIG.about,
    paymentMethods: STORE_CONFIG.paymentMethods,
    operatingHours: STORE_CONFIG.operatingHours,
    googleMapsUrl: STORE_CONFIG.googleMapsUrl
  },
  sushi: {
    id: "sushi",
    name: "Sushi Zen",
    slogan: "A Essência da Culinária Japonesa Tradicional e Moderna",
    logo: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=200&h=200",
    bannerImage: "https://images.unsplash.com/photo-1611143669185-af224c5e3252?auto=format&fit=crop&q=80&w=1200&h=400",
    phone: "5511888888888",
    address: "Rua Augusta, 1500 - Consolação, São Paulo - SP",
    colors: {
      primary: "#e11d48",
      background: "#f8fafc",
      secondary: "#0f172a",
      text: "#0f172a",
      card: "#ffffff",
      accent: "#f43f5e"
    },
    categories: ["Destaques", "Entradas", "Combinados", "Sashimi & Sushi", "Bebidas"],
    products: [
      {
        id: "s1",
        name: "Combinado Zen Premium (16 un)",
        description: "Saborosa seleção do Chef: 4 Salmon Jô, 4 Uramaki Filadélfia, 4 Niguiri de Salmão e 4 Hosso-maki de Atum.",
        price: 59.90,
        image: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=600",
        category: "Combinados",
        isAvailable: true,
        modifiers: [
          {
            id: "mod-molhos",
            title: "Molhos Extras",
            required: false,
            maxSelection: 3,
            options: [
              { id: "ms1", name: "Molho Shoyu Tradicional", extraPrice: 0 },
              { id: "ms2", name: "Molho Teriyaki Artesanal", extraPrice: 2.50 },
              { id: "ms3", name: "Molho Shoyu Light", extraPrice: 0 }
            ]
          }
        ]
      },
      {
        id: "s2",
        name: "Sunomono de Pepino clássico",
        description: "Salada refrescante de pepino japonês em conserva agridoce com gergelim preto e branco torrado.",
        price: 12.00,
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=600",
        category: "Entradas",
        isAvailable: true
      },
      {
        id: "s3",
        name: "Hot Roll Filadélfia (10 un)",
        description: "Sushis empanados fritos recheados com salmão fresco, cream cheese original e cebolinha fresca. Regado com molho teriyaki.",
        price: 29.90,
        image: "https://images.unsplash.com/photo-1611143669185-af224c5e3252?auto=format&fit=crop&q=80&w=600",
        category: "Sashimi & Sushi",
        isAvailable: true,
        modifiers: [
          {
            id: "mod-cream_cheese",
            title: "Cream Cheese Extra",
            required: false,
            maxSelection: 1,
            options: [
              { id: "cc1", name: "Dobro de Cream Cheese", extraPrice: 4.00 }
            ]
          }
        ]
      },
      {
        id: "s4",
        name: "Sashimi de Salmão Fresco (8 fatias)",
        description: "Lâminas super frescas e selecionadas de salmão premium, cortadas na espessura perfeita pelo nosso sushiman.",
        price: 34.00,
        image: "https://images.unsplash.com/photo-1534482421-64566f976cfa?auto=format&fit=crop&q=80&w=600",
        category: "Sashimi & Sushi",
        isAvailable: true
      },
      {
        id: "s5",
        name: "Temaki Completo de Salmão",
        description: "Cone de alga crocante nori recheado com salmão em cubos, cream cheese Filadélfia, cebolinha fresca picada e gergelim.",
        price: 24.90,
        image: "https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?auto=format&fit=crop&q=80&w=600",
        category: "Sashimi & Sushi",
        isAvailable: true
      },
      {
        id: "s6",
        name: "Cerveja Japonesa Kirin Ichiban",
        description: "Cerveja japonesa puro malte de sabor unique e refrescante. Garrafa long neck de 355ml.",
        price: 11.90,
        image: "https://images.unsplash.com/photo-1608270176050-dd2ec7098c4b?auto=format&fit=crop&q=80&w=600",
        category: "Bebidas",
        isAvailable: true
      },
      {
        id: "s7",
        name: "Chá Verde Quente ou Gelado",
        description: "Infusão tradicional de chá verde japonês (Ocha), rico em antioxidantes. Selecione a temperatura.",
        price: 6.90,
        image: "https://images.unsplash.com/photo-1564890369478-c90ae83ab28b?auto=format&fit=crop&q=80&w=600",
        category: "Bebidas",
        isAvailable: true,
        modifiers: [
          {
            id: "mod-temperatura",
            title: "Temperatura",
            required: true,
            maxSelection: 1,
            options: [
              { id: "t1", name: "Chá Verde Gelado", extraPrice: 0 },
              { id: "t2", name: "Chá Verde Quente (Bule)", extraPrice: 0 }
            ]
          }
        ]
      }
    ],
    socials: [
      { platform: "instagram", url: "https://instagram.com/sushizen", active: true },
      { platform: "facebook", url: "https://facebook.com/sushizen", active: false },
      { platform: "tiktok", url: "https://tiktok.com/@sushizen", active: true },
      { platform: "website", url: "https://sushizen.com.br", active: true }
    ],
    about: "O Sushi Zen nasceu para celebrar a milenar arte da culinária japonesa com toques contemporâneos de criatividade. Cada corte de sashimi é executado com precisão cirúrgica por sushimens formados no Japão, utilizando peixes frescos entregues diariamente de pesca sustentável.",
    paymentMethods: [
      { type: "Cartão de Crédito", accepted: ["Visa", "Mastercard", "Elo", "Amex"] },
      { type: "Cartão de Débito", accepted: ["Visa Electron", "Maestro"] },
      { type: "Refeição / Voucher", accepted: ["Sodexo", "Ticket", "Alelo", "VR"] },
      { type: "Pix", accepted: ["Pix com QR Code instantâneo"] }
    ],
    operatingHours: [
      { days: "Terça a Sexta", hours: "11:30 às 15:00, 18:30 às 23:00" },
      { days: "Sábado e Domingo", hours: "12:00 às 23:30" },
      { days: "Segunda-feira", hours: "Fechado" }
    ],
    googleMapsUrl: "https://maps.google.com/?q=Rua+Augusta,+1500+-+Consola%C3%A7%C3%A3o,+S%C3%A3o+Paulo+-+SP"
  },
  pizza: {
    id: "pizza",
    name: "Pizzeria Bella",
    slogan: "Pizzas de Fermentação Natural Assadas no Forno a Lenha",
    logo: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=200&h=200",
    bannerImage: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&q=80&w=1200&h=400",
    phone: "5511777777777",
    address: "Alameda Lorena, 200 - Jardins, São Paulo - SP",
    colors: {
      primary: "#10b981",
      background: "#fefdf6",
      secondary: "#b91c1c",
      text: "#1e293b",
      card: "#ffffff",
      accent: "#f59e0b"
    },
    categories: ["Destaques", "Pizzas Especiais", "Pizzas Doces", "Entradas", "Bebidas"],
    products: [
      {
        id: "p_m1",
        name: "Pizza Margherita Suprema",
        description: "Molho de tomate pelado italiano, mussarela fior di latte super fresca, tomates cereja doces, pesto de manjericão e folhas de manjericão gigante.",
        price: 49.90,
        image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=600",
        category: "Pizzas Especiais",
        isAvailable: true,
        modifiers: [
          {
            id: "mod-borda",
            title: "Opção de Borda",
            required: false,
            maxSelection: 1,
            options: [
              { id: "b1", name: "Sem borda recheada", extraPrice: 0 },
              { id: "b2", name: "Borda recheada de Catupiry", extraPrice: 8.00 },
              { id: "b3", name: "Borda recheada de Gorgonzola", extraPrice: 11.00 }
            ]
          }
        ]
      },
      {
        id: "p_m2",
        name: "Pizza Calabresa Artesanal",
        description: "Molho de tomate pelado, mussarela cremosa, fatias finas de calabresa artesanal defumada e cebola roxa marinada em azeite.",
        price: 45.90,
        image: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&q=80&w=600",
        category: "Pizzas Especiais",
        isAvailable: true,
        modifiers: [
          {
            id: "mod-borda",
            title: "Opção de Borda",
            required: false,
            maxSelection: 1,
            options: [
              { id: "b1", name: "Sem borda recheada", extraPrice: 0 },
              { id: "b2", name: "Borda recheada de Catupiry", extraPrice: 8.00 }
            ]
          }
        ]
      },
      {
        id: "p_m3",
        name: "Crostini de Ervas Aromáticas",
        description: "Massa fina de pizza bem crocante, assada com azeite de oliva extravirgem, alecrim fresco e sal grosso.",
        price: 14.00,
        image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=600",
        category: "Entradas",
        isAvailable: true
      },
      {
        id: "p_m4",
        name: "Pizza Nutella com Morangos",
        description: "Massa clássica crocante coberta com generosa camada de Nutella original, morangos frescos cortados e raspas de chocolate branco.",
        price: 36.90,
        image: "https://images.unsplash.com/photo-1511018556340-d16986a1c194?auto=format&fit=crop&q=80&w=600",
        category: "Pizzas Doces",
        isAvailable: true
      },
      {
        id: "p_m5",
        name: "Vinho Tinto Sangiovese (Taça)",
        description: "Taça de vinho tinto seco de uva Sangiovese da região da Toscana. Combina perfeitamente com nossas pizzas vermelhas.",
        price: 18.00,
        image: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&q=80&w=600",
        category: "Bebidas",
        isAvailable: true
      }
    ],
    socials: [
      { platform: "instagram", url: "https://instagram.com/pizzeriabella", active: true },
      { platform: "facebook", url: "https://facebook.com/pizzeriabella", active: true },
      { platform: "tiktok", url: "https://tiktok.com/@pizzeriabella", active: false },
      { platform: "website", url: "https://pizzeriabella.com.br", active: false }
    ],
    about: "Inspirada nas autênticas pizzarias napolitanas, a Pizzeria Bella prepara discos perfeitos de longa fermentação natural (48 horas de maturação lenta). Assamos no forno a lenha tradicional com madeira de reflorestamento, gerando aquela borda aerada 'canotto' deliciosamente chamuscada.",
    paymentMethods: [
      { type: "Cartão de Crédito", accepted: ["Visa", "Mastercard", "Elo"] },
      { type: "Cartão de Débito", accepted: ["Visa Electron", "Maestro"] },
      { type: "Pix", accepted: ["Chave PIX ou QR Code no cupom fiscal"] }
    ],
    operatingHours: [
      { days: "Segunda a Domingo", hours: "18:30 às 23:30" }
    ],
    googleMapsUrl: "https://maps.google.com/?q=Alameda+Lorena,+200+-+Jardins,+S%C3%A3o+Paulo+-+SP"
  }
};
