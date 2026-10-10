import {
  LEGAL_DOCUMENTS as LEGAL_V34_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV34';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '3.5';
export const LEGAL_EFFECTIVE_DATE = '10/10/2026';

// --- SEÇÕES ATUALIZADAS: termos ---

const TERMOS_SECTION_CARDAPIO: LegalSection = {
  title: '6. Cardápio digital e pedidos',
  paragraphs: [
    'O Cardápio Online disponibilizado pelo KÔMA constitui canal tecnológico para apresentação de produtos, recebimento de pedidos e acompanhamento de compras realizadas pelo consumidor junto ao estabelecimento. O restaurante responde pelas informações comerciais publicadas, pela oferta, pelos alimentos e pela relação de consumo relativa aos produtos vendidos, respondendo o KÔMA pelas obrigações decorrentes de sua atividade tecnológica.',
    'O CONTRATANTE poderá definir a ordem de apresentação de categorias, produtos, destaques e recomendações comerciais no Cardápio Online, respeitadas as funcionalidades contratadas, respondendo pela veracidade, exatidão e atualização de preços, descrições, imagens, disponibilidade, composição, alergênicos, horários de atendimento e taxas de entrega.',
    'O WhatsApp não é requisito para o consumidor realizar uma compra quando o checkout próprio do cardápio estiver disponível.',
    'O KÔMA pode aplicar validações técnicas, regras de segurança, limites operacionais, controles de idempotência e mecanismos de prevenção de duplicidade e abuso, disponibilizando estados de pedido como criado, aceito, rejeitado, em preparo, pronto, despachado e concluído.',
    'O envio do pedido registra uma solicitação ao estabelecimento. O fluxo operacional pode exigir confirmação e aceite prévio do restaurante antes do início do preparo.',
  ],
};

const TERMOS_SECTION_PAGAMENTOS: LegalSection = {
  title: '8. Pagamentos de consumidores e papel do provedor',
  paragraphs: [
    'O KÔMA poderá disponibilizar integrações tecnológicas com prestadores externos de serviços de pagamento, incluindo Mercado Pago e PagBank, conforme as modalidades habilitadas para o estabelecimento.',
    'A contratação, habilitação, análise cadastral, liquidação financeira, tarifas próprias do provedor, limites operacionais, bloqueios, reservas, estornos, contestações e demais obrigações financeiras são regidos pelas condições próprias do respectivo provedor externo, observadas as responsabilidades legais de cada parte.',
    'A disponibilização de integração tecnológica não implica garantia de aprovação cadastral, de disponibilidade contínua do serviço externo ou de liquidação de qualquer operação, respondendo o KÔMA pelas falhas que lhe sejam diretamente imputáveis na camada de software e integrações da plataforma.',
    'Na modalidade Pix Direto do estabelecimento, o CONTRATANTE poderá cadastrar chave Pix vinculada a conta de sua titularidade ou legitimamente utilizada para recebimento de suas vendas. Nessa modalidade, o KÔMA disponibiliza recursos tecnológicos para apresentação dos dados de pagamento e geração de QR Code, sem receber, custodiar, reter ou liquidar recursos financeiros.',
    'Compete ao CONTRATANTE verificar a titularidade, validade e correção da chave Pix cadastrada, conferir o efetivo crédito na instituição bancária recebedora e executar a conciliação manual no caixa, respondendo pelos dados bancários informados. A geração de QR Code ou a apresentação de comprovante pelo consumidor não representam, isoladamente, confirmação bancária de liquidação.',
    'Na modalidade Pix Direto, compete ao estabelecimento recebedor realizar os procedimentos de devolução de valores ao consumidor por meio da instituição financeira responsável pela conta de recebimento, observadas as hipóteses de cancelamento, pagamento indevido, cobrança duplicada e demais direitos previstos na legislação aplicável. O KÔMA não realiza a liquidação nem a devolução financeira de valores que não tenha recebido ou mantido sob sua custódia, permanecendo responsável pelas falhas diretamente atribuíveis às funcionalidades tecnológicas que disponibiliza.',
  ],
};

const TERMOS_SECTION_TAXA_KOMA: LegalSection = {
  title: '9. Taxa KÔMA sobre pagamentos online',
  paragraphs: [
    'Nas contratações regidas pela presente versão contratual, o KÔMA não cobra comissão percentual, taxa de intermediação ou participação sobre o valor dos pedidos realizados pelo Cardápio Online, sendo de 0% (zero por cento) a comissão da plataforma sobre tais pedidos nos planos Pocket, Pro e Premium.',
    'A ausência de comissão KÔMA não afasta a cobrança da assinatura mensal ou anual contratada, nem de serviços ou módulos adicionais que venham a ser expressamente contratados.',
    'Tarifas, encargos, custos de processamento, taxas de adquirência, antecipações, estornos ou contestações cobrados por instituições financeiras, adquirentes ou prestadores externos de pagamento (como Mercado Pago e PagBank) não constituem remuneração do KÔMA e são pagos diretamente pelo estabelecimento ao respectivo provedor.',
    'Contratos anteriormente celebrados permanecem preservados quanto às condições e percentuais registrados nos respectivos snapshots comerciais aceitos no momento da contratação. Nos pagamentos futuros desses estabelecimentos, o KÔMA aplica isenção de comissão sobre pedidos online, não havendo retenção de split remuneratório ou aplicação de application_fee pela plataforma. Nenhuma comissão será restabelecida sem previsão contratual válida, comunicação prévia e aceite formal quando aplicável.',
  ],
};

const TERMOS_SECTION_LGPD_CRM: LegalSection = {
  title: '15. Dados pessoais e LGPD',
  paragraphs: [
    'As partes obrigam-se ao cumprimento da Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 - LGPD). Para os dados pessoais tratados na operação do restaurante, gestão de pedidos, clientes e histórico de compras, o CONTRATANTE atua como Controlador e o KÔMA como Operador, regidos pelo Acordo de Tratamento de Dados Pessoais (DPA).',
    'O KÔMA poderá fornecer ferramentas de inteligência de vendas e relacionamento com clientes (CRM), englobando segmentação, indicadores de recência, frequência de compras (RFM), ticket médio e histórico transacional.',
    'Quando tais ferramentas forem utilizadas para finalidades comerciais definidas pelo CONTRATANTE, este responde pela identificação da base legal aplicável, pela transparência perante os consumidores titulares, pela legitimidade de campanhas promocionais e pelo atendimento aos direitos dos titulares, cabendo ao KÔMA atuar como operador nos limites das instruções lícitas e do DPA.',
    'A disponibilização de funcionalidades de CRM não autoriza o envio de comunicações publicitárias abusivas (spam), nem autoriza a formação de bases compartilhadas ou transferência de dados entre estabelecimentos distintos.',
  ],
};

const TERMOS_SECTION_PRESERVAÇÃO: LegalSection = {
  title: '24. Evolução do serviço e alterações jurídicas',
  paragraphs: [
    'O KÔMA pode evoluir funcionalidades, interfaces e regras técnicas da plataforma. Alterações materiais que impactem direitos ou obrigações serão comunicadas com antecedência razoável por meio da plataforma ou canais de contato cadastrados.',
    'A publicação de nova versão dos Termos não modificará automaticamente as condições econômicas e os direitos contratualmente preservados em instrumentos anteriores celebrados validamente. Alterações materiais dependerão de comunicação e, quando exigido pela legislação ou pelo contrato, de novo aceite.',
    'A preservação de versões históricas não impede atualizações imediatas relativas à segurança, correção de vulnerabilidades, adequação regulatória à LGPD ou cumprimento de determinações de autoridades competentes.',
  ],
};

const TERMOS_SECTION_ACEITE: LegalSection = {
  title: '25. Aceite eletrônico e evidências',
  paragraphs: [
    'A adesão aos instrumentos contratuais do KÔMA é formalizada mediante manifestação eletrônica válida do representante autorizado do CONTRATANTE, com registro de versão aceita, data, hora, IP, identificação do responsável e evidências técnicas auditáveis.',
    'As versões históricas dos contratos permanecerão arquivadas de forma imutável, sendo vedada sua substituição retroativa. O CONTRATANTE poderá consultar e emitir segunda via do comprovante do snapshot aceito a qualquer tempo pelo painel do sistema.',
  ],
};

// --- SEÇÕES ATUALIZADAS: planos ---

const PLANOS_SECTION_CATALOGO: LegalSection = {
  title: '1. Catálogo e preços',
  bullets: [
    'Pocket: R$ 79,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis.',
    'Pro: R$ 179,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis.',
    'Premium: R$ 329,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis.',
    'Não há taxa de implantação nem add-on obrigatório no catálogo padrão desta versão.',
    'Tarifas de gateways, adquirentes, bancos, Mercado Pago e PagBank permanecem separadas e são pagas pelo estabelecimento diretamente ao provedor conectado.',
    'O catálogo vigente orienta novas contratações. Valores e condições já aceitos por um contratante permanecem vinculados ao respectivo comprovante até mudança expressa de contratação ou novo aceite aplicável.',
  ],
};

const PLANOS_SECTION_TAXA: LegalSection = {
  title: '8. Taxa sobre pagamentos online',
  paragraphs: [
    'Para novas contratações desta versão, a comissão KÔMA sobre pedidos online é de 0% (zero por cento) nos planos Pocket, Pro e Premium. A plataforma não cobra participação percentual ou taxa de intermediação sobre os pedidos.',
    'Contratos anteriormente celebrados (versões v2.6 a v3.4) preservam os percentuais registrados nos respectivos snapshots comerciais aceitos. Nos pagamentos futuros desses estabelecimentos, a plataforma aplica isenção de comissão KÔMA, omitindo qualquer retenção de split ou taxa remuneratória (application_fee), sem que isso importe novação automática dos contratos históricos.',
    'Tarifas próprias dos prestadores externos de pagamento, taxas de adquirência, custos de antecipação e encargos bancários continuam sendo regidos pelos contratos entre o estabelecimento e as respectivas instituições.',
    'Nenhuma comissão será restabelecida sem prévia previsão contratual válida, notificação e aceite formal quando exigidos pela legislação.',
  ],
};

// --- SEÇÕES ATUALIZADAS: privacidade ---

const PRIVACIDADE_SECTION_PAPEIS: LegalSection = {
  title: '1. Escopo e papéis',
  paragraphs: [
    'Esta Política explica o tratamento de dados pessoais realizado pelo KÔMA. A qualificação dos agentes segue a participação efetiva nas finalidades e meios do tratamento, conforme a LGPD e orientações da ANPD.',
    'O KÔMA atua como Controlador dos dados pessoais tratados para finalidades próprias, incluindo administração de contas de contratantes, gestão comercial da assinatura SaaS, faturamento, segurança da infraestrutura, prevenção a fraudes, suporte técnico e cumprimento de obrigações legais.',
    'Nas operações realizadas em nome dos estabelecimentos contratantes — compreendendo a gestão operacional de pedidos, dados de entrega de consumidores e ferramentas de CRM — o KÔMA atua como Operador de dados, processando as informações estritamente de acordo com as instruções lícitas do restaurante Controlador e do DPA.',
  ],
};

const PRIVACIDADE_SECTION_NOTIFICACOES: LegalSection = {
  title: '5. Suporte, comunicações e notificações',
  paragraphs: [
    'Podemos tratar mensagens, anexos e histórico de atendimento nos canais oficiais para responder solicitações, solucionar incidentes e documentar a relação contratual.',
    'E-mail e WhatsApp podem ser utilizados para comunicações operacionais, alertas de segurança e notificações do contrato.',
    'Para acompanhamento em tempo real de pedidos no Cardápio Online, a plataforma pode tratar identificadores técnicos de navegador, registros de assinatura Web Push e dados do pedido quando o usuário autorizar a funcionalidade no dispositivo compatível. Esse tratamento restringe-se à finalidade operacional de acompanhamento.',
  ],
};

const PRIVACIDADE_SECTION_CRM: LegalSection = {
  title: '7. Finalidades e bases legais',
  paragraphs: [
    'Os dados de contratantes e usuários são tratados com base na execução do contrato SaaS, cumprimento de obrigações legais/regulatórias, legítimo interesse para segurança e prevenção a fraudes, e exercício regular de direitos.',
    'No âmbito do CRM e inteligência comercial disponibilizados aos restaurantes, o processamento de indicadores de consumo (frequência, recência e ticket médio) é realizado pelo KÔMA na condição de Operador, cabendo ao estabelecimento definir a base legal perante seus clientes.',
    'O KÔMA não utiliza dados pessoais identificáveis dos consumidores de um restaurante para campanhas publicitárias próprias, não comercializa bancos de dados de clientes e não realiza cruzamento de perfis entre restaurantes concorrentes.',
  ],
};

// --- SEÇÕES ATUALIZADAS: dpa ---

const DPA_SECTION_ESCOPO: LegalSection = {
  title: '2. Objeto, duração e instruções',
  paragraphs: [
    'O CONTROLADOR autoriza o OPERADOR a realizar, na medida necessária à prestação dos serviços contratados, operações de coleta, recepção, registro, organização, armazenamento, consulta, utilização, análise, transmissão e eliminação de dados pessoais referentes aos consumidores e usuários vinculados ao estabelecimento.',
    'As operações autorizadas compreendem a gestão de pedidos, cadastro e relacionamento com clientes, geração de indicadores de frequência e valor de consumo (CRM), segmentações comerciais no âmbito do estabelecimento, notificações transacionais de pedidos (incluindo Web Push), integração tecnológica com provedores de pagamento (Mercado Pago, PagBank e Pix direto) e suporte operacional.',
    'O OPERADOR somente tratará dados segundo as instruções lícitas e documentadas do CONTROLADOR, ressalvadas obrigações legais próprias e tratamentos em que atuar legitimamente como controlador independente.',
  ],
};

const DPA_SECTION_FINALIDADES: LegalSection = {
  title: '4. Finalidades do processamento',
  bullets: [
    'Receber, registrar, preparar, cobrar, entregar e acompanhar pedidos gastronômicos.',
    'Exibir cardápio e operar caixa, salão, comandas, cozinha, estoque, entregas e relatórios conforme o plano.',
    'Processar inteligência de vendas e métricas de relacionamento (CRM) para uso exclusivo do restaurante contratante.',
    'Autenticar usuários, aplicar níveis de permissão, prevenir duplicidade de pedidos, fraudes e abusos.',
    'Prestar suporte técnico, corrigir falhas, garantir segurança e permitir exportação e atendimento a direitos de titulares.',
  ],
};

const DPA_SECTION_OBRIGACOES_OPERADOR: LegalSection = {
  title: '6. Obrigações do KÔMA Operador',
  bullets: [
    'Tratar dados pessoais estritamente de acordo com as instruções lícitas do Controlador e para execução do SaaS.',
    'Não utilizar os dados disponibilizados pelo Controlador para formar bases comerciais compartilhadas entre restaurantes, vender perfis ou realizar publicidade própria sem fundamento jurídico autônomo.',
    'Adotar medidas de segurança técnicas e administrativas compatíveis com os padrões do mercado e salvaguardar a confidencialidade dos dados.',
    'Disponibilizar ferramentas tecnológicas que auxiliem o Controlador a atender solicitações de titulares (como correção, exclusão e oposição a comunicações de marketing).',
    'Excluir ou anonimizar dados processados em nome do estabelecimento após o término do contrato, observadas as retenções exigidas por lei.',
  ],
};

const DPA_SECTION_INCIDENTES: LegalSection = {
  title: '10. Incidentes',
  paragraphs: [
    'O OPERADOR notificará o CONTROLADOR em até 24 (vinte e quatro) horas a partir da ciência qualificada de qualquer incidente de segurança relevante que envolva dados pessoais tratados em nome do estabelecimento.',
    'A notificação inicial conterá as informações preliminares disponíveis sobre a natureza do evento, categorias de dados potencialmente afetadas e medidas imediatas de contenção adotadas, facultada a complementação progressiva das informações à medida que a apuração técnica avançar, sem que a ausência de conclusão integral da investigação justifique o atraso no aviso inicial.',
    'O prazo contratual de até 24 horas previsto nesta cláusula destina-se a viabilizar a cooperação técnica entre as partes e não se confunde com o prazo regulatório legal (em regra, de 3 dias úteis conforme a Resolução CD/ANPD nº 15/2024) conferido ao Controlador para eventual comunicação formal à Autoridade Nacional de Proteção de Dados (ANPD) e aos titulares de dados.',
  ],
};

// --- SEÇÕES COMPLETAS E ORDENADAS: suboperadores (13 seções em ordem estrita) ---

const SUBOPERADORES_SECTIONS: LegalSection[] = [
  {
    title: '1. Como interpretar esta lista',
    paragraphs: [
      'Nem todo terceiro é suboperador em todos os fluxos. Alguns atuam como operadores do KÔMA; outros podem atuar como controladores independentes ou manter relação direta com o restaurante, especialmente no processamento de pagamentos.',
      'A ativação de determinados serviços depende de configuração de produção. Quando um serviço estiver desabilitado, a mera presença do código de integração não significa tratamento ativo por aquele fornecedor.',
    ],
  },
  {
    title: '2. Railway',
    bullets: [
      'Finalidade: hospedagem do backend e serviços auxiliares.',
      'Localização técnica verificada na arquitetura: região sfo, Estados Unidos, sujeita à infraestrutura contratada.',
      'Dados possíveis: requisições, metadados técnicos, logs e dados processados pela aplicação conforme o serviço.',
    ],
  },
  {
    title: '3. Supabase',
    bullets: [
      'Finalidade: PostgreSQL, armazenamento e componentes de infraestrutura utilizados pelo KÔMA.',
      'Região técnica verificada no projeto principal: AWS us-west-2, Oregon, Estados Unidos.',
      'Dados possíveis: dados de restaurantes, usuários, pedidos, clientes, configurações e arquivos de cardápio conforme o recurso utilizado.',
    ],
  },
  {
    title: '4. Cloudflare',
    bullets: [
      'Finalidade: hospedagem/entrega do frontend e recursos de borda.',
      'Localização: rede global, podendo haver tratamento em múltiplas jurisdições conforme a arquitetura do provedor.',
      'Dados possíveis: endereço IP, metadados de rede e conteúdo técnico necessário à entrega da aplicação.',
    ],
  },
  {
    title: '5. Mercado Pago',
    bullets: [
      'Finalidade: OAuth do restaurante, pagamentos online, Pix integrado, cartão de crédito e cobrança recorrente do SaaS quando habilitados.',
      'Papel: instituição de pagamento que pode atuar como controladora independente para processamento financeiro e prevenção a fraude, e como fornecedor integrado de tecnologia.',
      'Dados possíveis: identificadores de transação, dados de compradores e estabelecimentos, valores e status de pagamento. Dados de cartão são coletados e processados em ambiente seguro do próprio provedor.',
      'Comissão KÔMA: 0% de retenção pela plataforma KÔMA. Tarifas de processamento financeiro do Mercado Pago são pagas diretamente pelo restaurante.',
    ],
  },
  {
    title: '6. PagBank',
    bullets: [
      'Finalidade: PagBank Connect, processamento de pagamentos online, cartão de crédito, Pix e liquidação integrada para restaurantes que optarem pela conexão.',
      'Papel: instituição de pagamento (PagSeguro Internet Instituição de Pagamento S.A.) que pode atuar como controladora independente para atividades financeiras reguladas e como fornecedor integrado de serviços de pagamento.',
      'Dados possíveis: identificadores de transação, dados cadastrais de compradores e estabelecimentos, valores e status de pagamento. Dados de cartão de crédito são tokenizados diretamente no ambiente seguro do PagBank.',
      'Comissão KÔMA: 0% de retenção pela plataforma KÔMA. Tarifas de processamento financeiro aplicadas pelo PagBank são regidas pelo contrato entre o estabelecimento e o PagBank.',
    ],
  },
  {
    title: '7. Instituições Bancárias e Pix Direto',
    paragraphs: [
      'Na modalidade Pix Direto, o restaurante cadastra chave Pix vinculada a conta bancária de sua própria titularidade para recebimento direto dos pagamentos de seus clientes.',
      'A instituição financeira recebedora mantém relação bancária direta e exclusiva com o restaurante, não constituindo suboperadora do KÔMA.',
      'O KÔMA não recebe, custodia, transita ou retém recursos financeiros nessa modalidade, limitando-se a apresentar em tela as instruções de pagamento e gerar o QR Code correspondente para leitura pelo aplicativo bancário do consumidor.',
    ],
  },
  {
    title: '8. Resend',
    bullets: [
      'Finalidade: envio de e-mails transacionais quando a integração estiver habilitada.',
      'Dados possíveis: destinatário, assunto, conteúdo da mensagem e metadados de entrega necessários ao envio.',
      'A ativação depende da configuração operacional de e-mail do KÔMA.',
    ],
  },
  {
    title: '9. WhatsApp, Meta e conector de mensageria',
    bullets: [
      'Finalidade: suporte, convites e notificações operacionais quando habilitados.',
      'O KÔMA pode utilizar conector auto-hospedado para orquestração e a infraestrutura do WhatsApp/Meta para entrega final das mensagens.',
      'Dados possíveis: número de telefone, conteúdo de mensagem e metadados de entrega.',
    ],
  },
  {
    title: '10. Google Fonts',
    bullets: [
      'Finalidade: carregamento de fontes web utilizadas pela interface enquanto permanecer ativo no frontend.',
      'O navegador pode realizar requisições aos domínios de fontes do Google e transmitir metadados técnicos usuais de rede, como endereço IP e User-Agent.',
      'A dependência pode ser removida ou substituída por hospedagem local sem necessidade de novo aceite quando não houver redução de direitos.',
    ],
  },
  {
    title: '11. Sentry, quando habilitado',
    bullets: [
      'Finalidade: monitoramento de erros e desempenho do backend quando SENTRY_DSN estiver configurado.',
      'Dados possíveis: stack traces, contexto técnico, identificadores de requisição e, somente se explicitamente habilitado, informações adicionais de contexto. O KÔMA busca minimizar dados pessoais no monitoramento.',
      'Se o serviço estiver desabilitado no ambiente, não há envio correspondente apenas pela presença do SDK no código.',
    ],
  },
  {
    title: '12. Transferência internacional e mecanismos',
    paragraphs: [
      'Railway, Supabase, Cloudflare, Google e outros fornecedores internacionais podem implicar transferência internacional. O KÔMA deve manter mecanismo válido de transferência conforme a LGPD e a Resolução CD/ANPD nº 19/2024 ou norma que a substitua.',
      'Quando o mecanismo utilizado depender de cláusulas contratuais, os instrumentos aplicáveis devem ser compatíveis com as cláusulas-padrão ou outro mecanismo reconhecido pela ANPD. Esta página não substitui a formalização contratual necessária.',
    ],
  },
  {
    title: '13. Atualizações',
    paragraphs: [
      'A lista pode mudar conforme a evolução da arquitetura. Inclusões que alterem materialmente o tratamento de dados serão refletidas nesta página e comunicadas quando exigido pela legislação ou pelo DPA.',
    ],
  },
];

// --- SEÇÕES ATUALIZADAS: cookies ---

const COOKIES_SECTION_NECESSARIAS: LegalSection = {
  title: '2. Tecnologias estritamente necessárias',
  bullets: [
    'Autenticação, sessão e continuidade de acesso seguro dos operadores e clientes.',
    'Tokens e identificadores para retomada de pedidos em andamento e navegação no cardápio.',
    'Service workers, identificadores técnicos e armazenamento local para acompanhamento do status do pedido e recebimento de notificações operacionais quando habilitadas pelo usuário.',
    'Preferências essenciais da aplicação, incluindo tema visual e configurações operacionais.',
    'Proteções de segurança, chaves de idempotência e prevenção a requisições duplicadas ou abusivas.',
  ],
};

const COOKIES_SECTION_WEBPUSH: LegalSection = {
  title: '6. Web Push e Notificações de Pedidos',
  paragraphs: [
    'Quando o consumidor opta por receber atualizações de pedidos no Cardápio Online, o navegador armazena a inscrição técnica (endpoint e chaves criptográficas) para entrega de mensagens operacionais de status.',
    'A permissão concedida ao navegador para notificações operacionais do pedido destina-se exclusivamente ao acompanhamento do pedido e não constitui consentimento para comunicações publicitárias ou marketing não solicitado.',
    'O usuário pode revogar a permissão a qualquer momento nas configurações do seu navegador ou dispositivo, sem prejuízo do acompanhamento do pedido pela página web correspondente.',
  ],
};

// --- SEÇÕES ATUALIZADAS: cardapio-termos ---

const CARDAPIO_TERMOS_SECTION_FORNECEDOR: LegalSection = {
  title: '1. Quem vende o produto',
  paragraphs: [
    'O restaurante identificado no Cardápio Online é o fornecedor dos alimentos, bebidas e demais produtos ofertados ao consumidor, respondendo por sua oferta, preços, preparo, acondicionamento, qualidade, entrega, retirada e garantia dos itens vendidos.',
    'O KÔMA é provedor da tecnologia e plataforma de software utilizada para disponibilização do cardápio digital, recebimento de pedidos e integração tecnológica com meios de pagamento, respondendo pelas obrigações decorrentes de sua atividade tecnológica.',
    'Questões sobre ingredientes, pedidos, atrasos, trocas, cancelamentos e atendimento ao cliente devem ser direcionadas ao restaurante vendedor, sem prejuízo das responsabilidades legais atribuíveis à plataforma por suas próprias atividades de software.',
  ],
};

const CARDAPIO_TERMOS_SECTION_OFERTA: LegalSection = {
  title: '2. Oferta, preços e disponibilidade',
  paragraphs: [
    'Preços, descrições, horários de funcionamento, taxas de entrega, promoções e disponibilidade de produtos são estabelecidos diretamente pelo restaurante.',
    'A ordem de exibição de categorias, produtos, itens em destaque e recomendações comerciais é configurada pelo restaurante com base em seus critérios de gestão e vendas. Destaques visuais não constituem recomendação técnica ou garantia de superioridade conferida pelo KÔMA.',
    'Antes de finalizar o pedido, o consumidor deve conferir detalhadamente itens, quantidades, adicionais, observações, endereço de entrega e valor total.',
  ],
};

const CARDAPIO_TERMOS_SECTION_PAGAMENTOS: LegalSection = {
  title: '4. Pagamentos online e Pix',
  paragraphs: [
    'Os meios de pagamento disponibilizados ao consumidor são determinados pelo estabelecimento comercial.',
    'Pagamentos processados por intermediadores externos (como Mercado Pago ou PagBank) obedecem às condições, análises de segurança e fluxos dos respectivos provedores.',
    'Na modalidade Pix Direto, os recursos são transferidos diretamente pelo consumidor para a conta bancária do restaurante. O consumidor deve conferir o nome do favorecido, instituição e valor exibidos em seu aplicativo bancário antes de autorizar a transferência. O KÔMA não recebe, custodia ou retém esses valores.',
    'No Pix Direto com conciliação manual, a confirmação do pagamento e o início do preparo podem depender de verificação do efetivo crédito na conta do restaurante. A exibição de comprovante ou encerramento da tela bancária não garante confirmação imediata sem a conciliação do estabelecimento.',
    'Na modalidade Pix Direto, compete ao estabelecimento recebedor realizar os procedimentos de devolução de valores ao consumidor por meio da instituição financeira responsável pela conta de recebimento, observadas as hipóteses de cancelamento, pagamento indevido, cobrança duplicada e demais direitos previstos na legislação aplicável. O KÔMA não realiza a liquidação nem a devolução financeira de valores que não tenha recebido ou mantido sob sua custódia, permanecendo responsável pelas falhas diretamente atribuíveis às funcionalidades tecnológicas que disponibiliza.',
  ],
};

const CARDAPIO_TERMOS_SECTION_CANCELAMENTOS: LegalSection = {
  title: '5. Cancelamentos, reembolsos e chargebacks',
  paragraphs: [
    'O KÔMA não retém comissão ou split financeiro sobre os pedidos online.',
    'Solicitações de cancelamento, arrependimento, reembolso ou solução de controvérsias serão avaliadas conforme a legislação de defesa do consumidor, a natureza perecível dos alimentos preparados e o estágio de execução do pedido.',
    'Quando houver cancelamento com reembolso em pagamento intermediado por adquirente ou gateway externo, a devolução será processada de acordo com os prazos e regras do provedor financeiro utilizado na transação.',
    'Na modalidade Pix Direto, eventuais estornos ou devoluções financeiras são operacionalizados diretamente pelo estabelecimento recebedor através de sua conta bancária.',
  ],
};

const CARDAPIO_TERMOS_SECTION_NOTIFICACOES: LegalSection = {
  title: '11. Acompanhamento e Notificações Web Push',
  paragraphs: [
    'O consumidor pode acompanhar o andamento de seu pedido em tempo real por meio da página web de acompanhamento disponibilizada após o envio.',
    'Em navegadores compatíveis, o consumidor pode autorizar notificações Web Push para receber alertas sobre mudanças de status (como pedido confirmado, em preparo, saiu para entrega ou pronto para retirada).',
    'A autorização para notificações operacionais é voluntária, gerenciada no navegador e pode ser revogada pelo usuário a qualquer momento nas configurações do dispositivo, sem prejuízo da consulta direta na página do pedido.',
  ],
};

// --- SEÇÕES ATUALIZADAS: cardapio-privacidade ---

const CARDAPIO_PRIVACIDADE_SECTION_PAPEIS: LegalSection = {
  title: '1. Controlador e Operador',
  paragraphs: [
    'Para os dados pessoais coletados no Cardápio Online para recepção, atendimento e execução do pedido, o restaurante identificado na página atua como Controlador dos dados. É o restaurante quem define as condições de venda e o relacionamento com o cliente.',
    'O KÔMA atua como Operador de dados pessoais, fornecendo a infraestrutura tecnológica segura e processando as informações estritamente para a viabilização do pedido e cumprimento das instruções do restaurante.',
    'O KÔMA poderá atuar como Controlador independente apenas em tratamentos estritamente necessários para a segurança da sua infraestrutura, prevenção a fraudes técnicas e cumprimento de obrigações legais.',
  ],
};

const CARDAPIO_PRIVACIDADE_SECTION_DADOS: LegalSection = {
  title: '2. Dados tratados no pedido',
  bullets: [
    'Identificação e contato: nome, telefone e dados de comunicação fornecidos para atendimento.',
    'Entrega: endereço completo, referências de localização e instruções para entrega no delivery.',
    'Itens e consumo: produtos selecionados, quantidades, complementos, valores, observações e histórico do pedido.',
    'Pagamento: modalidade escolhida, identificadores de transação e status de confirmação, sem que o KÔMA armazene números de cartão de crédito.',
    'Notificações técnicas: identificador de inscrição do navegador (endpoint e chaves criptográficas) para entrega de avisos de status do pedido quando ativado pelo usuário.',
    'Dados técnicos de segurança: endereço IP, data, hora, tipo de navegador e identificadores essenciais para prevenção de fraudes e duplicidades.',
  ],
};

const CARDAPIO_PRIVACIDADE_SECTION_FINALIDADES: LegalSection = {
  title: '4. Finalidades e CRM do Restaurante',
  paragraphs: [
    'Os dados do consumidor são utilizados para viabilizar as etapas de compra, atendimento e inteligência de vendas do restaurante.',
    'O restaurante vendedor poderá utilizar o histórico de compras para compreender padrões de consumo, frequência de pedidos, produtos preferidos e ticket médio por meio de ferramentas de inteligência comercial e CRM disponibilizadas na plataforma.',
    'O processamento de métricas de CRM é realizado pelo KÔMA exclusivamente em benefício do respectivo restaurante Controlador. O KÔMA não comercializa, não compartilha dados de consumidores entre restaurantes diferentes e não utiliza esses dados para publicidade própria.',
    'O consumidor pode solicitar a interrupção do envio de comunicações promocionais diretamente ao restaurante controlador.',
  ],
  bullets: [
    'Registrar, confirmar, preparar, cobrar, entregar e acompanhar o pedido.',
    'Prevenir duplicidade de pedidos, fraude e abuso na plataforma.',
    'Prestar atendimento ao cliente e resolver cancelamentos, contestações ou reembolsos.',
    'Cumprir obrigação legal, fiscal ou regulatória e permitir exercício regular de direitos.',
    'Gerar histórico e indicadores de relacionamento para o restaurante controlador.',
  ],
};

const CARDAPIO_PRIVACIDADE_SECTION_PAGAMENTOS: LegalSection = {
  title: '5. Pagamentos',
  paragraphs: [
    'Em pagamentos online integrados, os dados necessários à transação são transmitidos ao provedor externo escolhido pelo estabelecimento (Mercado Pago ou PagBank), que processa a operação em ambiente seguro.',
    'Na modalidade Pix Direto, o pagamento é transferido diretamente para a instituição bancária do restaurante. O KÔMA processa unicamente os registros operacionais para conciliação do pedido no caixa, sem receber ou custodiar recursos.',
  ],
};

const CARDAPIO_PRIVACIDADE_SECTION_DIREITOS: LegalSection = {
  title: '9. Direitos do titular',
  paragraphs: [
    'O consumidor pode exercer os direitos previstos na LGPD (confirmação de tratamento, acesso, correção, eliminação de dados e oposição a comunicações) diretamente perante o restaurante Controlador.',
    'O KÔMA prestará o suporte e a cooperação técnica necessários ao restaurante para atendimento tempestivo aos direitos dos titulares, conforme estabelecido no DPA.',
  ],
};

// --- MECANISMO DE SUBSTITUIÇÃO ROBUSTO POR PREFIXO NUMÉRICO ---

function replaceSectionByNumber(sections: LegalSection[], replacement: LegalSection): LegalSection[] {
  const match = replacement.title.match(/^(\d+)\./);
  if (!match) {
    throw new Error(`Seção sem prefixo numérico: ${replacement.title}`);
  }
  const prefix = `${match[1]}.`;
  let replaced = false;
  const updated = sections.map(section => {
    if (section.title.startsWith(prefix) || section.title === replacement.title) {
      replaced = true;
      return replacement;
    }
    return section;
  });
  if (!replaced) {
    updated.push(replacement);
  }
  return updated;
}

// --- CONSTRUÇÃO DOS DOCUMENTOS JURÍDICOS DA VERSÃO 3.5 ---

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V34_DOCUMENTS.map(document => {
  let doc: LegalDocument = {
    ...document,
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: document.sections.map(s => ({
      ...s,
      paragraphs: s.paragraphs ? [...s.paragraphs] : undefined,
      bullets: s.bullets ? [...s.bullets] : undefined,
    })),
  };

  if (doc.slug === 'termos') {
    doc.sections = replaceSectionByNumber(doc.sections, TERMOS_SECTION_CARDAPIO);
    doc.sections = replaceSectionByNumber(doc.sections, TERMOS_SECTION_PAGAMENTOS);
    doc.sections = replaceSectionByNumber(doc.sections, TERMOS_SECTION_TAXA_KOMA);
    doc.sections = replaceSectionByNumber(doc.sections, TERMOS_SECTION_LGPD_CRM);
    doc.sections = replaceSectionByNumber(doc.sections, TERMOS_SECTION_PRESERVAÇÃO);
    doc.sections = replaceSectionByNumber(doc.sections, TERMOS_SECTION_ACEITE);
  }

  if (doc.slug === 'planos') {
    doc.sections = replaceSectionByNumber(doc.sections, PLANOS_SECTION_CATALOGO);
    doc.sections = replaceSectionByNumber(doc.sections, PLANOS_SECTION_TAXA);
  }

  if (doc.slug === 'privacidade') {
    doc.sections = replaceSectionByNumber(doc.sections, PRIVACIDADE_SECTION_PAPEIS);
    doc.sections = replaceSectionByNumber(doc.sections, PRIVACIDADE_SECTION_NOTIFICACOES);
    doc.sections = replaceSectionByNumber(doc.sections, PRIVACIDADE_SECTION_CRM);
  }

  if (doc.slug === 'dpa') {
    doc.sections = replaceSectionByNumber(doc.sections, DPA_SECTION_ESCOPO);
    doc.sections = replaceSectionByNumber(doc.sections, DPA_SECTION_FINALIDADES);
    doc.sections = replaceSectionByNumber(doc.sections, DPA_SECTION_OBRIGACOES_OPERADOR);
    doc.sections = replaceSectionByNumber(doc.sections, DPA_SECTION_INCIDENTES);
  }

  if (doc.slug === 'suboperadores') {
    // Lista estrita de 13 seções, exatamente numeradas de 1 a 13
    doc.sections = SUBOPERADORES_SECTIONS;
  }

  if (doc.slug === 'cookies') {
    doc.sections = replaceSectionByNumber(doc.sections, COOKIES_SECTION_NECESSARIAS);
    doc.sections = replaceSectionByNumber(doc.sections, COOKIES_SECTION_WEBPUSH);
  }

  if (doc.slug === 'cardapio-termos') {
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_TERMOS_SECTION_FORNECEDOR);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_TERMOS_SECTION_OFERTA);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_TERMOS_SECTION_PAGAMENTOS);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_TERMOS_SECTION_CANCELAMENTOS);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_TERMOS_SECTION_NOTIFICACOES);
  }

  if (doc.slug === 'cardapio-privacidade') {
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_PRIVACIDADE_SECTION_PAPEIS);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_PRIVACIDADE_SECTION_DADOS);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_PRIVACIDADE_SECTION_FINALIDADES);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_PRIVACIDADE_SECTION_PAGAMENTOS);
    doc.sections = replaceSectionByNumber(doc.sections, CARDAPIO_PRIVACIDADE_SECTION_DIREITOS);
  }

  return doc;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find(document => document.slug === slug);
}
