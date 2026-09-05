export type LegalDocumentSlug =
  | 'termos'
  | 'planos'
  | 'privacidade'
  | 'dpa'
  | 'cardapio-termos'
  | 'cardapio-privacidade';

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  slug: LegalDocumentSlug;
  title: string;
  shortTitle: string;
  summary: string;
  audience: string;
  version: string;
  effectiveDate: string;
  sections: LegalSection[];
};

export const LEGAL_VERSION = '1.0';
export const LEGAL_EFFECTIVE_DATE = '05/09/2026';

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: 'termos',
    title: 'Termos de Contratação e Uso do KÔMA',
    shortTitle: 'Termos de Contratação',
    summary: 'Regras principais da relação entre o KÔMA e o restaurante contratante.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Objeto',
        paragraphs: [
          'O KÔMA disponibiliza ao restaurante acesso a uma plataforma de software como serviço (SaaS) para apoio à operação do estabelecimento, incluindo funcionalidades que podem abranger pedidos, salão, caixa, cardápio digital, estoque, produção e integrações de pagamento conforme o plano contratado.',
          'A contratação concede direito de uso da plataforma enquanto o plano estiver vigente. O código-fonte, marca, identidade visual e demais ativos do KÔMA não são transferidos ao restaurante.',
        ],
      },
      {
        title: '2. Responsabilidades do restaurante',
        bullets: [
          'Manter corretos os dados do estabelecimento, produtos, preços, disponibilidade, horários e demais informações oferecidas aos seus clientes.',
          'Responder pela venda, preparação, qualidade, segurança e entrega dos alimentos e serviços comercializados.',
          'Manter usuários e credenciais sob controle e comunicar acessos indevidos.',
          'Cumprir obrigações fiscais, sanitárias, consumeristas e demais deveres próprios da atividade do restaurante.',
        ],
      },
      {
        title: '3. Pagamentos online',
        paragraphs: [
          'Quando o restaurante optar por pagamentos online integrados, a conta do provedor de pagamento pertence ao próprio restaurante e é conectada ao KÔMA por fluxo autorizado do provedor.',
          'O KÔMA não atua como banco e não mantém em custódia o valor integral da venda do restaurante. O provedor de pagamento é responsável pela liquidação financeira segundo suas próprias regras. Quando previsto no plano, o provedor poderá separar automaticamente a taxa de plataforma do KÔMA da transação elegível.',
        ],
      },
      {
        title: '4. Disponibilidade, manutenção e terceiros',
        paragraphs: [
          'O KÔMA busca manter o serviço disponível e seguro, mas não garante operação ininterrupta. Manutenções, indisponibilidades de internet, energia, dispositivos, navegador, infraestrutura ou serviços de terceiros podem afetar temporariamente funcionalidades.',
          'Incidentes relevantes serão tratados de acordo com sua criticidade. O suporte prioritário, quando incluído no plano, não significa plantão ininterrupto ou garantia de tempo absoluto de solução.',
        ],
      },
      {
        title: '5. Cancelamento e encerramento',
        paragraphs: [
          'As condições econômicas, periodicidade e forma de cancelamento são apresentadas no resumo da contratação e nas Condições Comerciais vigentes. O encerramento da assinatura não elimina obrigações já constituídas antes da data efetiva de término.',
          'Sempre que tecnicamente e legalmente aplicável, o restaurante poderá solicitar acesso ou exportação de dados próprios antes da exclusão definitiva, observados prazos de retenção necessários para segurança, defesa de direitos e obrigações legais.',
        ],
      },
      {
        title: '6. Uso aceitável',
        bullets: [
          'Não usar a plataforma para fraude, atividade ilícita, invasão, engenharia reversa indevida ou tentativa de contornar controles de segurança.',
          'Não compartilhar acesso administrativo com terceiros não autorizados.',
          'Não utilizar o KÔMA para comercialização de itens proibidos por lei ou em violação a direitos de terceiros.',
        ],
      },
      {
        title: '7. Alterações dos termos',
        paragraphs: [
          'Mudanças relevantes nestes termos serão versionadas. Quando uma alteração exigir novo aceite, o KÔMA poderá solicitar confirmação eletrônica ao responsável pelo restaurante antes da continuidade do uso de funcionalidades afetadas.',
        ],
      },
    ],
  },
  {
    slug: 'planos',
    title: 'Condições Comerciais dos Planos KÔMA',
    shortTitle: 'Condições Comerciais',
    summary: 'Preço, taxa de plataforma, cobrança e regras comerciais dos planos.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Planos vigentes',
        bullets: [
          'Pocket: R$ 109 por mês + 1,49% sobre pedidos online pagos elegíveis.',
          'Pro: R$ 209 por mês + 0,69% sobre pedidos online pagos elegíveis.',
          'Premium: R$ 309 por mês + 0,29% sobre pedidos online pagos elegíveis.',
          'Não há taxa de implantação no catálogo comercial vigente.',
        ],
      },
      {
        title: '2. Plano anual',
        paragraphs: [
          'Quando a modalidade anual estiver disponível e for escolhida, o desconto de 10% incide somente sobre a mensalidade fixa. A taxa percentual sobre pedidos online pagos permanece a mesma do plano contratado.',
        ],
      },
      {
        title: '3. Taxas de pagamento',
        paragraphs: [
          'A taxa KÔMA é separada das tarifas eventualmente cobradas pelo provedor de pagamento. Custos do provedor não são definidos pelo KÔMA e seguem o contrato do restaurante com esse provedor.',
          'A taxa KÔMA somente incide nas transações online elegíveis processadas pelo fluxo integrado da plataforma. Pedidos pagos por outros meios não devem gerar a taxa de split da plataforma, salvo condição comercial expressa em contrário.',
        ],
      },
      {
        title: '4. Cobrança e vencimento',
        paragraphs: [
          'O meio de pagamento da assinatura, data de vencimento e eventual período promocional ou de teste devem constar no resumo individual da contratação. O KÔMA não cria cobrança automática sem que isso esteja indicado ao contratante.',
        ],
      },
      {
        title: '5. Mudança de plano',
        paragraphs: [
          'Upgrade ou downgrade pode alterar funcionalidades, mensalidade e taxa percentual. A nova condição passa a valer conforme a data informada no momento da alteração e fica registrada no histórico administrativo da conta.',
        ],
      },
    ],
  },
  {
    slug: 'privacidade',
    title: 'Política de Privacidade do KÔMA',
    shortTitle: 'Privacidade KÔMA',
    summary: 'Como tratamos dados de responsáveis, usuários e contatos dos restaurantes.',
    audience: 'Restaurantes, usuários e contatos comerciais',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Dados tratados',
        bullets: [
          'Dados cadastrais e de contato de responsáveis e usuários do restaurante.',
          'Dados de autenticação, perfis, permissões e registros de acesso.',
          'Dados comerciais, de suporte, cobrança e relacionamento com o restaurante.',
          'Registros técnicos necessários para segurança, prevenção a fraude, diagnóstico e auditoria.',
        ],
      },
      {
        title: '2. Finalidades',
        bullets: [
          'Criar e administrar contas, usuários, permissões e planos.',
          'Prestar o serviço contratado, oferecer suporte e comunicar eventos operacionais relevantes.',
          'Proteger a plataforma, prevenir abuso e investigar incidentes.',
          'Cumprir obrigações legais, regulatórias e exercer direitos em processos administrativos ou judiciais.',
        ],
      },
      {
        title: '3. Bases legais',
        paragraphs: [
          'Dependendo da finalidade, o tratamento pode se basear na execução de contrato, cumprimento de obrigação legal ou regulatória, exercício regular de direitos, legítimo interesse ou consentimento quando ele for efetivamente necessário. O KÔMA não usa consentimento genérico como fundamento para todas as operações de dados.',
        ],
      },
      {
        title: '4. Compartilhamentos e fornecedores',
        paragraphs: [
          'Podemos utilizar provedores de infraestrutura, banco de dados, hospedagem, monitoramento, comunicação e pagamentos estritamente na medida necessária à prestação do serviço. Entre os fornecedores atualmente relevantes estão Cloudflare, Railway, Supabase e Mercado Pago, conforme a funcionalidade utilizada.',
          'A lista de fornecedores pode mudar com a evolução da plataforma, sempre preservando controles contratuais e de segurança compatíveis com a natureza do tratamento.',
        ],
      },
      {
        title: '5. Retenção e segurança',
        paragraphs: [
          'Os dados são mantidos pelo tempo necessário para as finalidades informadas, vigência contratual, segurança, prevenção a fraude, obrigações legais e defesa de direitos. O KÔMA adota medidas técnicas e administrativas proporcionais ao risco, incluindo controle de acesso e segregação de dados entre restaurantes.',
        ],
      },
      {
        title: '6. Direitos e contato',
        paragraphs: [
          'Titulares podem solicitar informações, correção, acesso, eliminação quando aplicável e demais direitos previstos na legislação de proteção de dados. O pedido pode ser iniciado pelos canais oficiais de atendimento divulgados na landing page e na área do cliente.',
        ],
      },
    ],
  },
  {
    slug: 'dpa',
    title: 'Anexo de Tratamento de Dados (DPA)',
    shortTitle: 'Anexo de Dados (DPA)',
    summary: 'Responsabilidades de proteção de dados entre restaurante e KÔMA.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Papéis das partes',
        paragraphs: [
          'Para dados de consumidores, pedidos e operação tratados pelo KÔMA conforme instruções do restaurante, o restaurante tende a atuar como controlador e o KÔMA como operador. O KÔMA poderá atuar como controlador independente em tratamentos próprios, como segurança da plataforma, gestão contratual, cobrança e prevenção a fraude.',
        ],
      },
      {
        title: '2. Instruções e finalidade',
        paragraphs: [
          'O KÔMA tratará dados operacionais do restaurante para fornecer as funcionalidades contratadas e de acordo com as configurações e instruções legítimas do controlador, salvo quando houver obrigação legal própria.',
        ],
      },
      {
        title: '3. Confidencialidade e segurança',
        bullets: [
          'Acesso aos dados limitado a pessoas e sistemas que necessitem deles para a prestação do serviço.',
          'Segregação lógica entre restaurantes e controles de autorização no backend e banco de dados.',
          'Proteção de segredos e credenciais e proibição de compartilhamento indevido de tokens de terceiros.',
        ],
      },
      {
        title: '4. Suboperadores',
        paragraphs: [
          'O KÔMA poderá contratar fornecedores de infraestrutura e tecnologia para executar partes do tratamento. O KÔMA permanece responsável por selecionar fornecedores adequados ao serviço e limitar o compartilhamento ao necessário.',
        ],
      },
      {
        title: '5. Incidentes e cooperação',
        paragraphs: [
          'Quando tomar conhecimento de incidente de segurança relevante envolvendo dados tratados em nome do restaurante, o KÔMA buscará fornecer informações razoavelmente necessárias para avaliação, contenção e cumprimento das obrigações legais das partes.',
        ],
      },
      {
        title: '6. Encerramento',
        paragraphs: [
          'Após o término do contrato, os dados serão tratados conforme a política de retenção aplicável, obrigações legais e solicitações válidas de exportação ou eliminação. Cópias de segurança podem permanecer por período técnico limitado até seu ciclo normal de expiração.',
        ],
      },
    ],
  },
  {
    slug: 'cardapio-termos',
    title: 'Termos de Uso do Cardápio Digital',
    shortTitle: 'Termos do Cardápio',
    summary: 'Regras para consumidores que fazem pedidos no cardápio digital de um restaurante.',
    audience: 'Consumidores dos restaurantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Quem vende o pedido',
        paragraphs: [
          'O restaurante identificado no cardápio é o fornecedor dos alimentos, bebidas, preços, promoções, disponibilidade, preparo, retirada e entrega. O KÔMA fornece a tecnologia utilizada para registrar e acompanhar o pedido.',
        ],
      },
      {
        title: '2. Informações do cardápio',
        paragraphs: [
          'Preços, descrições, ingredientes, disponibilidade, horários, taxa de entrega e prazo estimado são administrados pelo restaurante. Em caso de alergias, restrições alimentares ou dúvidas sobre composição, o consumidor deve confirmar diretamente com o estabelecimento antes de concluir o pedido.',
        ],
      },
      {
        title: '3. Pagamento',
        paragraphs: [
          'Quando houver pagamento online, a transação é processada pelo provedor de pagamento indicado no checkout. O KÔMA não é instituição financeira e não substitui as regras do provedor.',
        ],
      },
      {
        title: '4. Cancelamento e devolução',
        paragraphs: [
          'Pedidos, cancelamentos, reembolsos e demais questões relacionadas à venda devem ser tratados com o restaurante, que poderá utilizar as ferramentas do KÔMA e do provedor de pagamento para executar as ações cabíveis.',
        ],
      },
      {
        title: '5. Uso adequado',
        paragraphs: [
          'O consumidor deve fornecer informações verdadeiras e suficientes para retirada ou entrega e não deve usar o cardápio para fraude, abuso, tentativa de acesso indevido ou interferência no funcionamento da plataforma.',
        ],
      },
    ],
  },
  {
    slug: 'cardapio-privacidade',
    title: 'Aviso de Privacidade do Cardápio Digital',
    shortTitle: 'Privacidade do Cardápio',
    summary: 'Como dados do consumidor são usados para receber e executar pedidos.',
    audience: 'Consumidores dos restaurantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Dados do pedido',
        bullets: [
          'Nome e informações de contato informadas no checkout.',
          'Endereço e referências quando houver entrega.',
          'Itens, valores, observações, modalidade de atendimento e histórico necessário à execução do pedido.',
          'Identificadores e status do pagamento quando houver pagamento online.',
        ],
      },
      {
        title: '2. Quem usa esses dados',
        paragraphs: [
          'O restaurante usa os dados para receber, preparar, cobrar, entregar e prestar atendimento sobre o pedido. O KÔMA processa essas informações para disponibilizar a tecnologia ao restaurante. Quando houver pagamento online, dados necessários à transação também são tratados pelo provedor de pagamento.',
        ],
      },
      {
        title: '3. Finalidades',
        bullets: [
          'Executar o pedido e prestar atendimento relacionado à compra.',
          'Prevenir fraude, abuso e incidentes de segurança.',
          'Manter registros necessários para suporte, conciliação e defesa de direitos.',
          'Cumprir obrigações legais aplicáveis às partes.',
        ],
      },
      {
        title: '4. Retenção',
        paragraphs: [
          'Os dados são mantidos pelo período necessário à operação do pedido, relacionamento com o restaurante, segurança, obrigações legais e defesa de direitos. O prazo pode variar de acordo com a natureza da informação e a responsabilidade de cada parte.',
        ],
      },
      {
        title: '5. Direitos',
        paragraphs: [
          'O consumidor pode procurar o restaurante para questões relacionadas ao pedido e ao uso dos dados no contexto da venda. Para dúvidas específicas sobre a tecnologia do KÔMA, também pode utilizar os canais oficiais de atendimento divulgados pela plataforma.',
        ],
      },
    ],
  },
];

export function findLegalDocument(slug: string | undefined): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
