export type LegalDocumentSlug =
  | 'termos'
  | 'planos'
  | 'privacidade'
  | 'dpa'
  | 'suboperadores'
  | 'cookies'
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

export const LEGAL_VERSION = '1.1';
export const LEGAL_EFFECTIVE_DATE = '05/09/2026';
export const LEGAL_PROVIDER_NAME = 'Georlan Gomes e Silva Júnior';
export const LEGAL_PROVIDER_LOCATION = 'Limoeiro do Norte/CE';
export const LEGAL_SUPPORT_SCHEDULE = 'todos os dias, das 09h às 23h, no horário de Brasília';

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: 'termos',
    title: 'Termos de Contratação e Uso do KÔMA',
    shortTitle: 'Termos de Contratação',
    summary: 'Contrato principal de uso do KÔMA entre o prestador da plataforma e o restaurante contratante.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Identificação das partes e documentos do contrato',
        paragraphs: [
          `O KÔMA é uma plataforma de software como serviço operada, nesta versão contratual, por ${LEGAL_PROVIDER_NAME}, pessoa física estabelecida em ${LEGAL_PROVIDER_LOCATION}. O CPF e os demais dados necessários à identificação jurídica do prestador constarão do Comprovante de Contratação individual entregue ao contratante e não precisam ser publicados no código-fonte da plataforma.`,
          'O contratante será a pessoa física ou jurídica identificada no resumo individual da contratação por nome ou razão social e CPF ou CNPJ. A pessoa que realiza o aceite eletrônico declara que forneceu dados verdadeiros e que possui poderes para contratar em nome do estabelecimento quando agir como representante.',
          'Integram o contrato o resumo individual da contratação, estes Termos, as Condições Comerciais do plano vigente e o Anexo de Tratamento de Dados. A Política de Privacidade e os avisos de privacidade têm natureza informativa e explicam os tratamentos de dados aplicáveis.',
        ],
      },
      {
        title: '2. Objeto e licença de uso',
        paragraphs: [
          'O KÔMA disponibiliza ao restaurante acesso a uma plataforma SaaS para apoio à operação do estabelecimento, com funcionalidades de acordo com o plano contratado, que podem abranger mesas, comandas, balcão, delivery, caixa, cardápio digital, produção, estoque, equipe, relatórios, integrações de pagamento, entregas e fidelização.',
          'A contratação concede licença limitada, não exclusiva, intransferível e revogável de uso da plataforma durante a vigência do contrato. Não há cessão de código-fonte, marca, identidade visual, métodos, documentação interna ou demais ativos intelectuais do KÔMA.',
        ],
      },
      {
        title: '3. Conta, usuários e segurança',
        bullets: [
          'O restaurante deve manter seus dados cadastrais, contatos e responsáveis atualizados.',
          'Credenciais são pessoais e não devem ser compartilhadas fora das permissões previstas na própria plataforma.',
          'O restaurante é responsável por cadastrar, remover e revisar os acessos de seus colaboradores e por comunicar suspeitas de acesso indevido.',
          'O KÔMA pode bloquear sessões, redefinir acessos ou exigir nova autenticação quando houver risco de segurança, fraude ou comprometimento de credenciais.',
        ],
      },
      {
        title: '4. Responsabilidades do restaurante',
        bullets: [
          'Manter corretos produtos, preços, descrições, disponibilidade, horários, taxas de entrega, promoções e demais informações apresentadas aos consumidores.',
          'Responder pela venda, preparo, qualidade, segurança sanitária, entrega, retirada, atendimento e cumprimento das obrigações relacionadas aos alimentos, bebidas e serviços que comercializa.',
          'Cumprir obrigações fiscais, sanitárias, trabalhistas, consumeristas e regulatórias próprias de sua atividade.',
          'Não usar o KÔMA para fraude, violação de direitos, produtos ilícitos ou vendas proibidas e respeitar regras específicas para itens sujeitos a restrição etária.',
          'Manter cópias ou exportações dos registros que a legislação obrigue o próprio restaurante a conservar fora da plataforma.',
        ],
      },
      {
        title: '5. Propriedade intelectual, conteúdo e confidencialidade',
        paragraphs: [
          'O restaurante mantém a titularidade sobre seus dados, cardápio, marcas, imagens e demais conteúdos que inserir no KÔMA e declara possuir autorização para utilizá-los. O KÔMA recebe apenas a licença necessária para hospedar, processar, exibir e transmitir esses conteúdos durante a prestação do serviço.',
          'Cada parte deve proteger informações confidenciais recebidas da outra e utilizá-las apenas para executar o contrato, cumprir obrigação legal, prevenir fraude, prestar suporte ou exercer direitos. Informações públicas, legitimamente obtidas de terceiro ou desenvolvidas de forma independente não são consideradas confidenciais.',
        ],
      },
      {
        title: '6. Preço, cobrança e taxa sobre pagamentos online',
        paragraphs: [
          'Mensalidade, modalidade de cobrança, taxa percentual e demais condições econômicas são as exibidas no resumo da contratação e detalhadas nas Condições Comerciais vigentes. Nenhuma cobrança automática da assinatura será iniciada sem autorização específica do contratante.',
          'Quando o plano prever taxa KÔMA sobre pagamentos online, o percentual incide sobre o valor bruto de cada pagamento online aprovado no fluxo integrado, com arredondamento monetário para centavos. Tarifas do provedor de pagamento são independentes e não se confundem com a taxa KÔMA.',
          'O KÔMA não atua como banco e não mantém em custódia o valor integral da venda do restaurante. Quando tecnicamente disponível, o provedor de pagamento pode separar automaticamente a parcela devida ao KÔMA e liquidar o restante para a conta conectada do restaurante.',
        ],
      },
      {
        title: '7. Teste gratuito e promoções',
        paragraphs: [
          'Salvo oferta individual diferente, o novo restaurante pode receber 7 dias de teste sem cobrança da mensalidade fixa. O teste não isenta a taxa percentual incidente sobre pagamentos online reais processados durante o período.',
          'O teste não gera débito automático ao terminar. A continuidade do acesso pago depende da confirmação da contratação e da forma de pagamento indicada no resumo. Promoções futuras, inclusive campanhas comemorativas, serão regidas pelas condições divulgadas na oferta específica e não alteram permanentemente o preço-base do plano.',
        ],
      },
      {
        title: '8. Suporte, disponibilidade e manutenção',
        paragraphs: [
          `O canal principal de suporte é o WhatsApp oficial divulgado pelo KÔMA. O atendimento humano é oferecido ${LEGAL_SUPPORT_SCHEDULE}. Mensagens podem ser recebidas fora dessa janela, sem garantia de resposta imediata.`,
          'O KÔMA emprega esforços razoáveis para manter o serviço disponível e seguro, mas não promete percentual mínimo de uptime nesta versão contratual. Internet, energia, navegador, dispositivos, provedores de nuvem, serviços de pagamento, WhatsApp e outros terceiros podem afetar temporariamente funcionalidades.',
          'Manutenções planejadas serão comunicadas quando razoavelmente possível. Alterações urgentes por segurança, fraude, indisponibilidade crítica ou obrigação legal podem ser executadas sem aviso prévio.',
        ],
      },
      {
        title: '9. Integrações e terceiros',
        paragraphs: [
          'Funcionalidades de infraestrutura, armazenamento, entrega de conteúdo, mensagens e pagamentos dependem de fornecedores externos identificados na página de Fornecedores, Suboperadores e Transferências. Cada serviço externo também pode possuir termos próprios aplicáveis à relação direta do restaurante ou do usuário com esse fornecedor.',
          'O KÔMA é responsável por selecionar e administrar os fornecedores que contratar como operadores ou suboperadores, dentro de seu âmbito de controle. O KÔMA não assume obrigações regulatórias próprias de instituições financeiras, operadores de telecomunicação ou outros controladores independentes.',
        ],
      },
      {
        title: '10. Suspensão e inadimplência',
        paragraphs: [
          'Havendo atraso da mensalidade ou da cobrança anual, o contratante terá período de tolerância de 5 dias corridos após o vencimento. Depois disso, o KÔMA poderá suspender de forma reversível o acesso a funcionalidades operacionais até a regularização.',
          'A suspensão por inadimplência não autoriza exclusão imediata dos dados. Permanecerão disponíveis os meios razoavelmente necessários para regularização, atendimento e exercício dos direitos de exportação e privacidade, observadas limitações técnicas e de segurança.',
          'Se a inadimplência ultrapassar 30 dias corridos, o KÔMA poderá encerrar o contrato mediante comunicação ao contato oficial do contratante, preservando a janela de exportação e as retenções legalmente necessárias.',
          'O KÔMA também poderá suspender imediatamente contas usadas para fraude, ataque, risco concreto à segurança, violação grave de lei ou tentativa de comprometer outros restaurantes, sem prejuízo de posterior apuração e regularização quando cabível.',
        ],
      },
      {
        title: '11. Cancelamento, término e dados',
        paragraphs: [
          'O plano mensal pode ser cancelado a qualquer momento. O acesso permanece até o fim do período já pago e não haverá nova renovação após a data efetiva do cancelamento, sem devolução proporcional da mensalidade do ciclo iniciado, salvo obrigação legal ou falha imputável ao KÔMA que justifique solução diversa.',
          'O plano anual pode ser cancelado antecipadamente conforme a fórmula de restituição descrita nas Condições Comerciais. A restituição não inclui taxas transacionais já geradas por pagamentos online efetivamente processados.',
          'Após o término, o restaurante terá 30 dias para solicitar ou realizar exportação dos dados próprios disponibilizados para essa finalidade. Encerrada essa janela, os dados serão eliminados, anonimizados ou mantidos apenas quando necessários para obrigação legal, segurança, prevenção a fraude, registros de incidente, comprovação contratual ou exercício regular de direitos.',
        ],
      },
      {
        title: '12. Responsabilidade e limites',
        paragraphs: [
          'O restaurante é o fornecedor dos produtos e serviços vendidos a seus consumidores. O KÔMA responde pela prestação de sua tecnologia dentro dos limites de controle da plataforma e não substitui obrigações do restaurante relativas a alimentos, equipe, tributos, logística ou atendimento ao consumidor.',
          'Na máxima extensão permitida pela legislação aplicável, nenhuma parte responde por lucros cessantes, perda de oportunidade ou danos indiretos que não sejam consequência direta e previsível de seu descumprimento. Quando juridicamente válida, a responsabilidade patrimonial total do KÔMA por danos diretos decorrentes do contrato fica limitada ao total efetivamente pago ao KÔMA pelo contratante nos 12 meses anteriores ao evento que originou a reclamação.',
          'A limitação anterior não se aplica a dolo, culpa grave, violação intencional de propriedade intelectual, danos à integridade física nem a responsabilidades que a lei determine que não podem ser excluídas ou limitadas, inclusive obrigações cogentes de proteção de dados e de defesa do consumidor quando aplicáveis.',
        ],
      },
      {
        title: '13. Alterações do serviço e dos termos',
        paragraphs: [
          'O KÔMA pode evoluir interfaces, fluxos e funcionalidades. Redução material de recurso incluído no plano, alteração econômica extraordinária ou mudança contratual relevante será comunicada, sempre que possível, com pelo menos 30 dias de antecedência, permitindo ao contratante cancelar antes da entrada em vigor sem cobrança de multa de cancelamento.',
          'Mudanças exigidas por lei, segurança, fraude, risco técnico grave ou serviço de terceiro podem ter prazo menor. Alterações jurídicas relevantes são versionadas e podem exigir novo aceite eletrônico.',
        ],
      },
      {
        title: '14. Comunicações oficiais',
        paragraphs: [
          'O e-mail cadastrado pelo administrador do restaurante é o canal oficial para avisos contratuais, reajustes, suspensão, incidentes, mudança material de termos e pedidos de novo aceite. O restaurante deve mantê-lo atualizado.',
          'O WhatsApp oficial pode ser usado como canal complementar de suporte e comunicação operacional. A ausência de leitura de mensagem enviada a contato desatualizado não elimina a obrigação do contratante de manter seus dados corretos.',
        ],
      },
      {
        title: '15. Lei aplicável e foro',
        paragraphs: [
          'Este contrato é regido pelas leis da República Federativa do Brasil. Para relações estritamente empresariais e quando a cláusula de eleição de foro for juridicamente válida, as partes elegem o foro de Limoeiro do Norte, Ceará, sem prejuízo de tentativa prévia de solução amigável.',
          'A eleição de foro não afasta competência territorial obrigatória, direitos de consumidor eventualmente aplicáveis nem outras normas cogentes que prevaleçam sobre esta disposição.',
        ],
      },
    ],
  },
  {
    slug: 'planos',
    title: 'Condições Comerciais dos Planos KÔMA',
    shortTitle: 'Condições Comerciais',
    summary: 'Preço, recursos, cobrança, trial, taxa transacional, reajuste, mudança de plano e cancelamento.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Catálogo e preços vigentes',
        bullets: [
          'Pocket: R$ 109 por mês + 1,49% sobre pagamentos online aprovados elegíveis.',
          'Pro: R$ 209 por mês + 0,69% sobre pagamentos online aprovados elegíveis.',
          'Premium: R$ 309 por mês + 0,29% sobre pagamentos online aprovados elegíveis.',
          'Não há taxa de implantação no catálogo comercial desta versão.',
        ],
      },
      {
        title: '2. Recursos e limitações do Pocket',
        bullets: [
          'Inclui mesas, comandas e balcão.',
          'Inclui cardápio digital e QR Code com pedidos no PDV.',
          'Inclui retirada e delivery no mesmo caixa.',
          'Inclui fila de preparo na tela, sem impressora.',
          'Inclui caixa, fechamento e resumo de vendas.',
          'Inclui clientes e histórico de pedidos.',
          'Não inclui KDS dedicado nem impressão automática.',
          'Não inclui estoque, fichas técnicas e financeiro completo.',
          'Não inclui app do entregador nem fidelidade.',
        ],
      },
      {
        title: '3. Recursos e limitações do Pro',
        bullets: [
          'Inclui tudo do Pocket.',
          'Inclui KDS e impressão automática.',
          'Inclui estoque, fichas técnicas e financeiro.',
          'Inclui garçom web e permissões da equipe.',
          'Inclui relatórios completos para acompanhamento do negócio.',
          'Não inclui app do entregador nem fidelidade.',
        ],
      },
      {
        title: '4. Recursos do Premium',
        bullets: [
          'Inclui tudo do Pro.',
          'Inclui app do entregador.',
          'Inclui pontos, cashback e cupons.',
          'Inclui suporte prioritário dentro da janela oficial de atendimento. Prioridade significa ordenação preferencial do atendimento e não promessa de solução em prazo absoluto.',
        ],
      },
      {
        title: '5. Modalidade anual',
        paragraphs: [
          'Na modalidade anual, a cobrança da mensalidade fixa é feita em uma única parcela antecipada equivalente a 12 mensalidades com desconto de 10% sobre esse componente fixo. A taxa percentual sobre pagamentos online permanece a mesma do plano.',
          'Valores anuais desta versão: Pocket R$ 1.177,20; Pro R$ 2.257,20; Premium R$ 3.337,20. O resumo individual da contratação prevalece caso uma promoção válida e expressamente identificada altere esses valores.',
          'Enquanto a cobrança do KÔMA for manual, o plano anual não será debitado novamente de forma automática ao final de 12 meses. Renovação automática futura somente poderá ocorrer após autorização específica do contratante.',
        ],
      },
      {
        title: '6. Definição da taxa KÔMA online',
        paragraphs: [
          'A taxa KÔMA é calculada sobre o valor bruto de cada pagamento online aprovado por meio da integração elegível da plataforma, utilizando o percentual vigente do plano no instante da aprovação e arredondamento para centavos.',
          'A taxa KÔMA é separada das tarifas cobradas pelo provedor de pagamento. Pedidos pagos fora do fluxo online integrado não geram a taxa de split, salvo condição comercial individual expressa em sentido diferente.',
          'Em reembolso processado pelo fluxo de Split 1:1 do provedor, a reversão financeira da parcela do marketplace e da parcela do restaurante segue a mecânica do próprio provedor. O KÔMA não deve cobrar uma segunda devolução manual da mesma taxa.',
        ],
      },
      {
        title: '7. Teste gratuito de 7 dias',
        paragraphs: [
          'Salvo oferta individual diferente, o primeiro teste do estabelecimento dura 7 dias a partir da ativação e isenta somente a mensalidade fixa. Transações online reais processadas durante o teste continuam sujeitas à taxa percentual do plano.',
          'O término do trial não autoriza débito automático. Sem confirmação da contratação paga, o KÔMA poderá suspender as funcionalidades pagas ao final do período, preservando os dados conforme as regras de retenção e exportação.',
        ],
      },
      {
        title: '8. Cobrança mensal, vencimento e renovação',
        paragraphs: [
          'Na fase atual, a cobrança da assinatura é realizada manualmente pelo KÔMA. O vencimento e o meio de pagamento aparecem no resumo individual ou na cobrança enviada ao contato oficial do restaurante.',
          'O plano mensal se renova por períodos mensais sucessivos enquanto não for cancelado. A cobrança manual não autoriza débito em conta ou cartão sem autorização específica. Quando houver automação futura, o contratante deverá ser informado previamente do meio, valor, periodicidade e mecanismo de cancelamento.',
        ],
      },
      {
        title: '9. Cancelamento mensal',
        paragraphs: [
          'O restaurante pode cancelar o plano mensal a qualquer momento. O cancelamento impede a renovação seguinte e mantém o acesso até o término do período já pago. Não há multa de cancelamento nem restituição proporcional do ciclo mensal iniciado, ressalvadas hipóteses legais ou acordo específico.',
        ],
      },
      {
        title: '10. Cancelamento antecipado do anual',
        paragraphs: [
          'O restaurante pode cancelar o plano anual antes dos 12 meses. Para calcular a restituição, o período efetivamente utilizado será recalculado pelo preço mensal normal do plano, sem o desconto anual. Meses completos serão cobrados pelo valor mensal normal e eventual fração do mês corrente será calculada proporcionalmente por dia, considerando 1/30 da mensalidade para cada dia utilizado.',
          'A restituição corresponde ao valor anual efetivamente pago menos o valor recalculado do período utilizado. O resultado nunca gera dívida adicional para o contratante: se o saldo calculado for igual ou inferior a zero, não haverá restituição nem cobrança complementar por esse motivo.',
          'Quando houver saldo a devolver, o KÔMA realizará a restituição em até 10 dias úteis após confirmar o cancelamento e os dados necessários ao pagamento. Taxas transacionais já geradas por pagamentos online efetivamente processados não integram essa restituição.',
        ],
      },
      {
        title: '11. Upgrade e downgrade',
        paragraphs: [
          'Upgrade ou downgrade solicitado pelo administrador autorizado produz efeito funcional imediato. A mensalidade fixa será ajustada proporcionalmente ao período restante do ciclo vigente e o impacto financeiro deverá ser exibido antes da confirmação.',
          'A taxa percentual do novo plano passa a valer somente para pagamentos online aprovados após a efetivação da mudança. Crédito decorrente de downgrade poderá ser aplicado ao ciclo seguinte ou devolvido no encerramento, conforme o resumo apresentado na alteração.',
        ],
      },
      {
        title: '12. Reajuste e alterações de preço',
        paragraphs: [
          'A mensalidade fixa poderá ser reajustada a cada 12 meses pela variação acumulada do IPCA ou índice oficial que o substitua. Alteração comercial extraordinária fora desse ciclo será comunicada com antecedência mínima de 30 dias, salvo obrigação legal de prazo menor.',
          'Se o contratante não concordar com alteração extraordinária que aumente o preço, poderá cancelar antes da entrada em vigor sem multa de cancelamento. Promoções temporárias não alteram o preço-base para reajustes futuros, salvo se a oferta disser expressamente o contrário.',
        ],
      },
      {
        title: '13. Inadimplência',
        paragraphs: [
          'O pagamento possui tolerância de 5 dias corridos após o vencimento. Depois desse período, o KÔMA poderá suspender de forma reversível o acesso até a regularização. O atraso não autoriza hard delete dos dados.',
          'Enquanto não houver política individual diferente, o KÔMA não cobra multa ou juros de mora automáticos. Se essa política mudar, o valor e a forma de cálculo deverão ser informados antes de se aplicarem a novo ciclo.',
        ],
      },
      {
        title: '14. Recibos, documentos fiscais e promoções',
        paragraphs: [
          'O KÔMA fornecerá comprovante da contratação e do pagamento e emitirá recibo ou documento fiscal quando aplicável à natureza jurídica e tributária do prestador no momento da cobrança. Cada parte permanece responsável por suas próprias obrigações fiscais.',
          'Descontos, campanhas de aniversário, cupons comerciais ou outras promoções futuras somente se aplicam quando expressamente oferecidos e podem possuir prazo, elegibilidade e regras próprias informadas antes da contratação.',
        ],
      },
    ],
  },
  {
    slug: 'privacidade',
    title: 'Política de Privacidade do KÔMA',
    shortTitle: 'Privacidade KÔMA',
    summary: 'Como o KÔMA trata dados de responsáveis, usuários, contatos comerciais e registros necessários à prestação do SaaS.',
    audience: 'Restaurantes, usuários e contatos comerciais',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Quem é o responsável por esta política',
        paragraphs: [
          `Para os tratamentos próprios descritos nesta Política, o KÔMA é operado por ${LEGAL_PROVIDER_NAME}, em ${LEGAL_PROVIDER_LOCATION}, que atua como controlador quando decide finalidades como contratação, cobrança do SaaS, segurança, suporte, prevenção a fraude e gestão da relação comercial.`,
          'Para dados de consumidores, pedidos e operação tratados segundo instruções do restaurante, os papéis são descritos no DPA e no Aviso de Privacidade do Cardápio. O canal de privacidade, enquanto não houver e-mail dedicado, é o WhatsApp oficial divulgado na landing page e na área do cliente; o titular deve identificar sua solicitação como assunto de privacidade ou LGPD.',
        ],
      },
      {
        title: '2. Dados que podemos tratar',
        bullets: [
          'Nome, e-mail, telefone, CPF ou CNPJ informado na contratação, cargo/função e dados do estabelecimento.',
          'Dados de autenticação, perfis, permissões, registros de sessão e eventos de segurança.',
          'Plano, modalidade de cobrança, pagamentos da assinatura, histórico de suporte e relacionamento.',
          'Endereço IP, User-Agent, identificadores técnicos, horário de acesso, rota, request-id e outros metadados necessários para segurança, diagnóstico e obrigação legal.',
          'Conteúdo enviado voluntariamente em chamados de suporte, desde que necessário à solução do problema.',
        ],
      },
      {
        title: '3. Como os dados são obtidos',
        paragraphs: [
          'Os dados podem ser fornecidos diretamente pelo responsável do restaurante, por usuários convidados pelo próprio estabelecimento, gerados durante o uso da plataforma ou recebidos de integrações autorizadas, como o provedor de pagamento, quando necessários à funcionalidade escolhida.',
        ],
      },
      {
        title: '4. Finalidades e bases legais',
        bullets: [
          'Executar a contratação, criar contas, administrar plano e prestar o serviço: execução de contrato e procedimentos preliminares.',
          'Processar cobrança, manter comprovantes e cumprir deveres fiscais, regulatórios ou judiciais: execução de contrato, obrigação legal ou regulatória e exercício regular de direitos.',
          'Autenticar usuários, impedir abuso, investigar incidentes e proteger a plataforma: legítimo interesse, prevenção a fraude, segurança e exercício regular de direitos, conforme o caso.',
          'Atender suporte e comunicações operacionais: execução de contrato e legítimo interesse compatível com a relação existente.',
          'Atender solicitações de titulares e autoridades: cumprimento de obrigação legal ou regulatória e exercício regular de direitos.',
        ],
      },
      {
        title: '5. Marketing',
        paragraphs: [
          'O KÔMA não utiliza atualmente os dados de usuários ou consumidores para campanhas automáticas de marketing. Se futuramente houver comunicação promocional facultativa, ela será apresentada de forma separada das comunicações necessárias ao contrato e contará com mecanismo adequado de preferência ou oposição.',
        ],
      },
      {
        title: '6. Compartilhamentos e fornecedores',
        paragraphs: [
          'O KÔMA utiliza fornecedores de infraestrutura, banco de dados, entrega de conteúdo, mensagens e pagamentos na medida necessária à prestação do serviço. A lista atual, a finalidade e a região conhecida de processamento estão publicadas em Fornecedores, Suboperadores e Transferências.',
          'O Mercado Pago possui responsabilidades próprias relacionadas a pagamento, liquidação, prevenção a fraude, KYC e obrigações regulatórias, podendo atuar como controlador independente para essas finalidades. Outros provedores que tratem dados apenas sob instruções do KÔMA são administrados como operadores ou suboperadores conforme a função efetivamente exercida.',
        ],
      },
      {
        title: '7. Transferências internacionais',
        paragraphs: [
          'Parte relevante da infraestrutura do KÔMA está hospedada fora do Brasil. O backend Railway opera atualmente em San Francisco, Estados Unidos, e o banco principal Supabase/AWS está atualmente na região us-west-2, Oregon, Estados Unidos. A Cloudflare utiliza rede global de borda e o WhatsApp/Meta utiliza infraestrutura global. A localização do processamento do Mercado Pago não é determinada pelo painel atualmente disponível ao KÔMA.',
          'Quando houver transferência internacional de dados pessoais, o KÔMA aplica a base e o mecanismo jurídicos adequados ao fluxo, observando a LGPD e a regulamentação da ANPD, incluindo garantias contratuais ou outras hipóteses legalmente permitidas quando aplicáveis. A mera localização de um fornecedor no exterior não elimina os direitos do titular previstos na legislação brasileira.',
        ],
      },
      {
        title: '8. Cookies, armazenamento local e tecnologias semelhantes',
        paragraphs: [
          'O KÔMA utiliza armazenamento local do navegador e recursos técnicos estritamente necessários para autenticação, segurança, tema visual, continuidade de pedidos, rastreamento do pedido e idempotência de operações. Há também cookie técnico de preferência de interface em determinados componentes.',
          'Não utilizamos atualmente pixels publicitários ou analytics de marketing no frontend. O documento Cookies e Tecnologias Locais detalha essas categorias e será atualizado antes da adoção de tecnologia não essencial que exija mecanismo adicional de preferência ou consentimento.',
        ],
      },
      {
        title: '9. Retenção',
        bullets: [
          'Dados de conta e contrato: durante a relação contratual e, após seu término, pelo prazo necessário a obrigações legais e exercício regular de direitos.',
          'Comprovantes de aceite, versões contratuais e registros de contratação: preservados pelo prazo necessário à comprovação da relação, em regra por até 5 anos após o encerramento, sem prejuízo de prazo legal diferente.',
          'Dados operacionais do restaurante: ficam disponíveis durante o contrato e pela janela de exportação de 30 dias após o término, ressalvadas retenções legais e cópias de segurança em ciclo técnico limitado.',
          'Registros de acesso e segurança: mantidos de acordo com os prazos legalmente aplicáveis e a política interna de segurança e retenção.',
          'Incidentes de segurança: registros mantidos pelo prazo regulatório aplicável, atualmente no mínimo 5 anos quando submetidos ao Regulamento de Comunicação de Incidente de Segurança da ANPD.',
        ],
      },
      {
        title: '10. Segurança',
        paragraphs: [
          'O KÔMA adota medidas técnicas e administrativas proporcionais ao risco, incluindo segregação lógica entre restaurantes, controles de autorização, RLS no banco principal, proteção de credenciais, criptografia de segredos sensíveis, TLS em trânsito, auditoria de ações privilegiadas e práticas de backup e restauração.',
          'Nenhum sistema é imune a incidentes. Ao confirmar incidente relevante, o KÔMA seguirá o plano interno de resposta e as obrigações aplicáveis de comunicação e cooperação.',
        ],
      },
      {
        title: '11. Direitos dos titulares',
        bullets: [
          'Confirmação da existência de tratamento e acesso aos dados.',
          'Correção de dados incompletos, inexatos ou desatualizados.',
          'Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade, quando aplicável.',
          'Portabilidade nos termos da regulamentação aplicável.',
          'Eliminação de dados tratados com consentimento quando essa for a base utilizada, observadas as hipóteses legais de conservação.',
          'Informação sobre compartilhamentos e sobre a possibilidade de não fornecer consentimento quando consentimento for solicitado.',
          'Revogação do consentimento e oposição a tratamento nas hipóteses legalmente cabíveis.',
          'Peticionamento perante a ANPD e demais autoridades competentes.',
        ],
      },
      {
        title: '12. Como exercer direitos',
        paragraphs: [
          'Solicitações podem ser iniciadas gratuitamente pelo canal oficial de privacidade divulgado pelo KÔMA. Podemos pedir informações razoáveis para verificar a identidade do solicitante e evitar acesso indevido a dados de terceiros.',
          'Quando o pedido envolver dados tratados primariamente sob controle do restaurante, o KÔMA poderá orientar o titular a procurar o estabelecimento e cooperará tecnicamente com o controlador nos termos do DPA.',
        ],
      },
      {
        title: '13. Alterações desta política',
        paragraphs: [
          'Mudanças materiais serão publicadas em nova versão. Quando a alteração modificar significativamente finalidades, compartilhamentos, transferências ou direitos, o KÔMA dará destaque compatível com o impacto e, quando necessário, solicitará nova manifestação do usuário.',
        ],
      },
    ],
  },
  {
    slug: 'dpa',
    title: 'Anexo de Tratamento de Dados (DPA)',
    shortTitle: 'Anexo de Dados (DPA)',
    summary: 'Regras de proteção de dados entre o restaurante controlador e o KÔMA operador.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Incorporação e papéis das partes',
        paragraphs: [
          'Este DPA integra os Termos de Contratação quando o KÔMA trata dados pessoais em nome do restaurante. Para dados de consumidores, pedidos, endereços, clientes e operação processados segundo as instruções e configurações do estabelecimento, o restaurante atua como Controlador e o KÔMA atua como Operador.',
          'Quando o KÔMA decide finalidades próprias, como segurança da plataforma, prevenção a fraude, gestão contratual, cobrança da assinatura e comprovação do aceite, atua como Controlador independente apenas para esses tratamentos. Se o restaurante atuar como operador de outro controlador, o KÔMA poderá atuar como suboperador na extensão tecnicamente aplicável.',
        ],
      },
      {
        title: '2. Objeto, duração e instruções',
        paragraphs: [
          'O tratamento tem por objeto fornecer as funcionalidades contratadas pelo restaurante e dura enquanto o contrato permanecer vigente, acrescido dos períodos de exportação, backup e retenção legal aplicáveis.',
          'As configurações realizadas pelo restaurante, os comandos enviados por seus usuários autorizados, o uso regular das funcionalidades e as instruções documentadas nos canais oficiais constituem instruções do Controlador. O KÔMA poderá recusar instrução manifestamente ilícita, insegura ou incompatível com a plataforma e informará o motivo quando juridicamente possível.',
        ],
      },
      {
        title: '3. Categorias de titulares',
        bullets: [
          'Consumidores que realizam ou acompanham pedidos.',
          'Clientes cadastrados pelo restaurante.',
          'Funcionários, entregadores, garçons, caixas, gerentes e demais usuários autorizados pelo restaurante.',
          'Representantes, fornecedores ou contatos inseridos pelo restaurante quando uma funcionalidade exigir esses dados.',
        ],
      },
      {
        title: '4. Categorias de dados e operações',
        bullets: [
          'Identificação e contato: nome, telefone, e-mail e identificadores internos.',
          'Entrega e atendimento: endereço, referências, modalidade de retirada/entrega e status do pedido.',
          'Operação: pedidos, itens, valores, observações, histórico, permissões e registros necessários ao serviço.',
          'Pagamento: identificadores, status e metadados de transação; o KÔMA não necessita armazenar número de cartão para o fluxo Pix atualmente integrado.',
          'Segurança: IP, User-Agent, sessão, logs, request-id e eventos de autenticação.',
          'As operações podem incluir coleta, recepção, armazenamento, organização, consulta, uso, transmissão, correção, exportação, restrição, anonimização e eliminação conforme a funcionalidade utilizada.',
        ],
      },
      {
        title: '5. Dados sensíveis e observações de saúde',
        paragraphs: [
          'O KÔMA não foi projetado para coletar dados sensíveis em larga escala. Contudo, um consumidor pode informar voluntariamente dado de saúde necessário à preparação segura do pedido, como alergia alimentar, em campo de observação.',
          'O restaurante deve orientar seus usuários a coletar somente o mínimo necessário e não utilizar campos livres para registrar dados sensíveis que não sejam indispensáveis à finalidade operacional. O KÔMA aplicará aos dados recebidos as mesmas salvaguardas de acesso e segregação do restante da operação, sem utilizá-los para publicidade ou perfil comportamental.',
        ],
      },
      {
        title: '6. Obrigações do restaurante controlador',
        bullets: [
          'Garantir base legal, transparência e legitimidade para os dados que decidir coletar ou inserir na plataforma.',
          'Manter informações do cardápio, contato e privacidade disponíveis ao consumidor e atender seus direitos como controlador.',
          'Conceder acesso ao KÔMA apenas aos dados necessários à prestação do serviço.',
          'Informar prontamente ao KÔMA instruções, restrições ou incidentes sob seu controle que possam afetar o tratamento.',
          'Não instruir o KÔMA a praticar tratamento ilícito ou incompatível com a finalidade contratada.',
        ],
      },
      {
        title: '7. Obrigações do KÔMA operador',
        bullets: [
          'Tratar dados pessoais apenas para prestar o serviço, cumprir instruções legítimas e obrigações legais aplicáveis.',
          'Limitar acesso a pessoas e sistemas que necessitem dos dados para suas funções.',
          'Manter controles de segregação entre restaurantes, autenticação, autorização, proteção de credenciais e comunicação segura.',
          'Cooperar com o restaurante no atendimento de direitos dos titulares, incidentes e comprovação razoável de conformidade.',
          'Não vender dados operacionais do restaurante nem utilizá-los para publicidade comportamental própria.',
        ],
      },
      {
        title: '8. Suboperadores e terceiros',
        paragraphs: [
          'O restaurante concede autorização geral para o KÔMA utilizar suboperadores necessários à prestação do serviço, desde que a lista pública seja mantida atualizada e sejam exigidas obrigações de proteção compatíveis com a função desempenhada.',
          'Mudança material de suboperador que amplie significativamente categorias de dados ou região de processamento será comunicada, quando razoavelmente possível, com 30 dias de antecedência. O restaurante poderá apresentar objeção fundamentada em proteção de dados; se não houver solução razoável, poderá encerrar a funcionalidade ou o contrato afetado sem cobrança de multa de cancelamento para o período futuro.',
          'Mercado Pago e outros agentes que decidam finalidades financeiras ou regulatórias próprias não são tratados automaticamente como suboperadores; seu papel é definido conforme a atividade efetivamente realizada.',
        ],
      },
      {
        title: '9. Transferências internacionais',
        paragraphs: [
          'O restaurante reconhece que parte da infraestrutura atualmente utilizada pelo KÔMA processa dados nos Estados Unidos ou em rede global, conforme a lista pública de fornecedores. O KÔMA deverá adotar a base e o mecanismo de transferência exigidos pela LGPD e pela regulamentação da ANPD para cada fluxo aplicável.',
          'Este DPA não substitui cláusulas-padrão ou instrumentos que a legislação determine que sejam celebrados com um importador de dados específico. Quando um mecanismo obrigatório exigir texto padronizado ou instrumento adicional, o KÔMA deverá incorporá-lo ao relacionamento com o respectivo fornecedor ou adotar outra hipótese legal válida antes de depender desse fluxo como mecanismo definitivo de conformidade.',
        ],
      },
      {
        title: '10. Direitos dos titulares',
        paragraphs: [
          'Quando uma solicitação do titular depender de ação técnica do KÔMA sobre dados tratados em nome do restaurante, o KÔMA buscará prestar a cooperação necessária em até 5 dias úteis, contados do recebimento de instrução suficientemente clara do Controlador, ressalvada complexidade extraordinária ou prazo legal diferente.',
          'O KÔMA não decidirá em lugar do restaurante se determinado pedido de eliminação, acesso ou oposição deve ser juridicamente deferido quando essa decisão pertencer ao Controlador.',
        ],
      },
      {
        title: '11. Incidentes de segurança',
        paragraphs: [
          'Ao confirmar incidente de segurança relevante que afete dados pessoais tratados em nome do restaurante, o KÔMA notificará o Controlador sem demora injustificada e terá como prazo contratual máximo 24 horas após a confirmação, salvo impossibilidade técnica ou legal devidamente justificada.',
          'Na medida das informações disponíveis, a comunicação indicará natureza e período do incidente, categorias de titulares e dados afetados, medidas de contenção adotadas, riscos conhecidos e ponto de contato para acompanhamento. Informações adicionais poderão ser fornecidas em etapas conforme a investigação avançar.',
          'O restaurante continua responsável por avaliar as obrigações de comunicação que a legislação lhe atribua como Controlador. O KÔMA cooperará razoavelmente para que o restaurante cumpra os prazos aplicáveis.',
        ],
      },
      {
        title: '12. Auditoria e comprovação',
        paragraphs: [
          'O KÔMA manterá documentação interna compatível com seu porte e risco, incluindo registro de operações, fornecedores, medidas de segurança, incidentes e políticas de retenção. Mediante solicitação razoável do restaurante, poderá fornecer informações suficientes para demonstrar as medidas pertinentes sem expor segredos de outros clientes, credenciais, vulnerabilidades ou informações confidenciais de terceiros.',
        ],
      },
      {
        title: '13. Encerramento, exportação e eliminação',
        paragraphs: [
          'Após o término do contrato, o restaurante terá janela de 30 dias para solicitar ou realizar exportação dos dados operacionais disponibilizados para essa finalidade. Depois desse período, o KÔMA eliminará ou anonimizará os dados que não precisem ser mantidos por obrigação legal, segurança, backup em ciclo técnico, registro de incidente ou exercício regular de direitos.',
          'Cópias de segurança podem persistir temporariamente até o ciclo normal de expiração e permanecerão sujeitas às mesmas restrições de acesso e finalidade, sem retorno ao uso operacional salvo necessidade de restauração legítima.',
        ],
      },
      {
        title: '14. Prevalência',
        paragraphs: [
          'Em conflito sobre tratamento de dados pessoais em nome do restaurante, este DPA prevalece sobre disposições gerais dos Termos. Cláusulas-padrão de transferência internacional ou obrigação legal cogente aplicável prevalecem sobre disposição incompatível deste DPA na extensão necessária ao seu cumprimento.',
        ],
      },
    ],
  },
  {
    slug: 'suboperadores',
    title: 'Fornecedores, Suboperadores e Transferências',
    shortTitle: 'Fornecedores e Transferências',
    summary: 'Lista pública dos principais terceiros ativos e das regiões de processamento conhecidas do KÔMA.',
    audience: 'Restaurantes e usuários',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Como ler esta lista',
        paragraphs: [
          'Nem todo terceiro exerce o mesmo papel jurídico. Infraestrutura contratada para processar dados em nome do KÔMA pode atuar como operador ou suboperador. Provedores que possuem obrigações próprias, especialmente financeiras e regulatórias, podem atuar como controladores independentes para parte de suas atividades.',
          'A região informada reflete a configuração de produção verificada na data desta versão e pode mudar mediante evolução da arquitetura e atualização desta página.',
        ],
      },
      {
        title: '2. Railway Corporation',
        bullets: [
          'Finalidade: hospedagem do backend FastAPI, serviços auxiliares e volumes da aplicação.',
          'Região atual: sfo, San Francisco, Califórnia, Estados Unidos.',
          'Dados: dados transacionais processados pelo backend, metadados de acesso e logs técnicos necessários à operação.',
          'Papel predominante: operador/suboperador de infraestrutura.',
        ],
      },
      {
        title: '3. Supabase / infraestrutura AWS',
        bullets: [
          'Finalidade: PostgreSQL principal com RLS e armazenamento de imagens do cardápio quando utilizado.',
          'Região atual do projeto principal: AWS us-west-2, Oregon, Estados Unidos.',
          'Dados: cadastro de restaurantes e usuários, clientes, pedidos, operação, registros financeiros e demais dados persistidos pela aplicação; Storage contém principalmente imagens de cardápio.',
          'Papel predominante: operador/suboperador de banco de dados e armazenamento.',
        ],
      },
      {
        title: '4. Cloudflare',
        bullets: [
          'Finalidade: Cloudflare Pages, CDN, terminação de conexão e proteção de borda do frontend.',
          'Região: rede global Anycast, sem um único país de processamento.',
          'Dados: IP, User-Agent, cabeçalhos e metadados de requisição necessários à entrega e segurança do conteúdo.',
          'Papel predominante: operador/suboperador de entrega de conteúdo e segurança de rede.',
        ],
      },
      {
        title: '5. Mercado Pago',
        bullets: [
          'Finalidade: criação de Pix, OAuth da conta do restaurante, Split 1:1, liquidação, consulta e reembolso.',
          'Região de processamento: não determinada pelo painel do desenvolvedor utilizado pelo KÔMA.',
          'Dados: e-mail do pagador, valor, referência do pedido, identificadores e status da transação, além de dados exigidos diretamente pelo Mercado Pago em sua relação com o restaurante ou pagador.',
          'Papel: provedor de pagamento com responsabilidades próprias; pode atuar como controlador independente para KYC, prevenção a fraude, liquidação e obrigações regulatórias.',
        ],
      },
      {
        title: '6. WhatsApp / Meta e conector de mensagens',
        bullets: [
          'Finalidade: envio de OTP, convites e notificações operacionais de pedido quando a automação estiver habilitada.',
          'Infraestrutura do conector atual: Evolution API auto-hospedada no Railway em San Francisco, Estados Unidos.',
          'Entrega final: infraestrutura global do WhatsApp/Meta.',
          'Dados: telefone do destinatário e conteúdo da mensagem necessária à funcionalidade solicitada.',
          'O KÔMA pretende priorizar integrações oficiais e poderá substituir o conector atual por API oficialmente suportada, com atualização desta lista quando a mudança entrar em produção.',
        ],
      },
      {
        title: '7. Google Fonts',
        bullets: [
          'Finalidade: carregamento remoto de fontes tipográficas na interface web atual.',
          'Região: infraestrutura global da Google, com possível processamento internacional.',
          'Dados: IP, User-Agent e metadados de requisição enviados diretamente pelo navegador ao carregar as fontes.',
          'O KÔMA pretende reduzir dependências desnecessárias e poderá migrar as fontes para hospedagem própria; até essa mudança estar publicada, o Google Fonts permanece nesta lista.',
        ],
      },
      {
        title: '8. Serviços não ativos nesta versão',
        paragraphs: [
          'n8n não está ativo em produção nesta versão. Sentry no frontend não está habilitado. Provedores de e-mail e SMS dedicados também não estão integrados. A lista somente deve incluir como ativos os serviços que efetivamente processam dados em produção.',
        ],
      },
      {
        title: '9. Alterações da lista',
        paragraphs: [
          'Mudança material de fornecedor que amplie significativamente a finalidade, as categorias de dados ou a região de processamento será publicada em nova versão e, quando razoavelmente possível, comunicada com antecedência de 30 dias aos restaurantes afetados, ressalvadas substituições urgentes por segurança, indisponibilidade ou obrigação legal.',
        ],
      },
    ],
  },
  {
    slug: 'cookies',
    title: 'Cookies, Armazenamento Local e Tecnologias Semelhantes',
    shortTitle: 'Cookies e Tecnologias Locais',
    summary: 'Uso atual de armazenamento técnico no navegador e regras para futuras tecnologias não essenciais.',
    audience: 'Usuários e consumidores',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. O que usamos hoje',
        paragraphs: [
          'O KÔMA utiliza principalmente localStorage, armazenamento de sessão e um número reduzido de cookies técnicos para manter autenticação, preferências de interface, continuidade de pedidos, rastreamento do pedido e segurança de operações.',
        ],
      },
      {
        title: '2. Categorias necessárias',
        bullets: [
          'Autenticação e sessão: permitem reconhecer usuário autorizado e manter contexto de acesso.',
          'Segurança e idempotência: ajudam a impedir repetição indevida de ações e a recuperar operações interrompidas.',
          'Preferências: guardam tema visual e configurações da interface escolhidas pelo usuário.',
          'Pedido do consumidor: permitem acompanhar temporariamente pedido ativo e sessão do cardápio.',
        ],
      },
      {
        title: '3. Analytics e publicidade',
        paragraphs: [
          'Não utilizamos atualmente cookies de publicidade, pixels de remarketing ou analytics comportamental no frontend do KÔMA. Se tecnologia não essencial desse tipo for adotada no futuro, sua finalidade será informada antes do uso e será oferecido mecanismo de preferência, rejeição ou consentimento quando exigido pela legislação aplicável.',
        ],
      },
      {
        title: '4. Recursos externos',
        paragraphs: [
          'Alguns recursos carregados pelo navegador podem gerar requisições a terceiros, como o Google Fonts nesta versão. Esses fluxos são descritos na lista de Fornecedores, Suboperadores e Transferências e podem ser removidos à medida que o KÔMA internalize recursos estáticos.',
        ],
      },
      {
        title: '5. Limpeza pelo usuário',
        paragraphs: [
          'O usuário pode apagar cookies e armazenamento local pelas configurações do navegador. A remoção de dados estritamente necessários pode encerrar sessões, apagar preferências locais ou impedir a recuperação de um pedido em andamento, sem eliminar os registros que precisem permanecer no servidor por obrigação contratual ou legal.',
        ],
      },
    ],
  },
  {
    slug: 'cardapio-termos',
    title: 'Termos de Uso do Cardápio Digital',
    shortTitle: 'Termos do Cardápio',
    summary: 'Regras para consumidores que consultam o cardápio e realizam pedidos em um restaurante que utiliza o KÔMA.',
    audience: 'Consumidores dos restaurantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Quem vende o pedido',
        paragraphs: [
          'O restaurante identificado no cardápio é o fornecedor dos alimentos, bebidas e serviços e é responsável por preços, promoções, disponibilidade, preparo, segurança alimentar, retirada, entrega, atendimento e cumprimento da oferta. O KÔMA fornece a tecnologia usada para exibir o cardápio, registrar o pedido e acompanhar seu status.',
          'Os dados de identificação e contato do restaurante devem ser apresentados no cardápio ou no checkout de forma compatível com a legislação aplicável. O KÔMA não substitui o restaurante como vendedor da refeição.',
        ],
      },
      {
        title: '2. Informações antes de finalizar',
        paragraphs: [
          'Antes da conclusão do pedido, o consumidor deve poder revisar itens, quantidades, preços, descontos, modalidade de atendimento, endereço quando houver entrega, taxa de entrega e total. A ferramenta deve permitir correção de erros antes do envio definitivo.',
          'Descrições, ingredientes, disponibilidade, horários, área de entrega e estimativas são administrados pelo restaurante e podem mudar antes da confirmação do pedido. Alteração posterior que prejudique o consumidor deve ser comunicada e tratada pelo estabelecimento conforme os direitos legalmente aplicáveis.',
        ],
      },
      {
        title: '3. Envio e confirmação do pedido',
        paragraphs: [
          'O envio pelo cardápio registra a solicitação do consumidor. A confirmação operacional depende do fluxo configurado pelo restaurante, da disponibilidade e, quando houver pagamento online, da aprovação da transação. O status exibido pelo sistema representa o estado registrado no KÔMA naquele momento.',
          'O consumidor receberá na própria interface, e quando disponível por mensagem, os dados necessários para acompanhar o pedido. Falha de internet ou mensageria não altera por si só um pedido já registrado no backend.',
        ],
      },
      {
        title: '4. Pagamento online',
        paragraphs: [
          'Quando houver Pix online, a transação é processada pelo provedor de pagamento informado no checkout. O KÔMA transmite somente os dados necessários à criação e conciliação da transação e não é instituição financeira.',
          'Tarifas do provedor e a distribuição do valor entre restaurante e plataforma seguem as regras comerciais aplicáveis entre essas partes e não aumentam silenciosamente o total exibido ao consumidor.',
        ],
      },
      {
        title: '5. Cancelamento, reembolso e direitos do consumidor',
        paragraphs: [
          'Pedidos, cancelamentos, correções e reembolsos relacionados à compra devem ser solicitados ao restaurante pelos canais informados no cardápio. O restaurante pode utilizar o KÔMA e o provedor de pagamento para executar a solução financeira cabível.',
          'Estes Termos não eliminam direito de arrependimento, garantia, restituição, cumprimento forçado da oferta ou qualquer outro direito que a legislação determine que seja aplicável ao caso concreto. Quando o pagamento online já tiver sido liquidado e houver direito à devolução, o reembolso deverá seguir o meio tecnicamente adequado e ser refletido no acompanhamento financeiro.',
        ],
      },
      {
        title: '6. Alergias e informações de saúde',
        paragraphs: [
          'Em caso de alergia, intolerância ou restrição alimentar, o consumidor deve confirmar diretamente com o restaurante ingredientes, risco de contaminação cruzada e possibilidade de adaptação antes de consumir o produto.',
          'Campo de observação pode ser usado para informar dado de saúde estritamente necessário à preparação segura do pedido. Não inclua informações sensíveis sem relação com a compra.',
        ],
      },
      {
        title: '7. Crianças, adolescentes e itens restritos',
        paragraphs: [
          'O cardápio pode ser acessado por pessoas de diferentes idades. O tratamento de dados de crianças e adolescentes deve observar seu melhor interesse, minimização e as regras específicas da legislação brasileira.',
          'Enquanto o KÔMA não disponibilizar mecanismo confiável de aferição de idade compatível com a legislação aplicável, o restaurante não deve disponibilizar para conclusão online pelo cardápio itens cuja oferta ou venda seja proibida a menores de 18 anos, incluindo bebida alcoólica. O KÔMA poderá bloquear categorias restritas para proteger consumidores e cumprir obrigação legal.',
        ],
      },
      {
        title: '8. Uso adequado',
        bullets: [
          'Fornecer dados verdadeiros e suficientes para retirada, entrega e contato sobre o pedido.',
          'Não utilizar o cardápio para fraude, pedidos abusivos, tentativa de acesso a dados de terceiros ou interferência na plataforma.',
          'Não explorar falhas, automatizar requisições abusivas ou tentar contornar controles de pagamento, segurança ou restrição etária.',
        ],
      },
      {
        title: '9. Disponibilidade e terceiros',
        paragraphs: [
          'Internet, serviços de nuvem, provedores de pagamento e mensageria podem ficar temporariamente indisponíveis. Se houver dúvida sobre a confirmação do pedido, o consumidor deve verificar o status exibido e contatar o restaurante antes de repetir a compra para evitar duplicidade.',
        ],
      },
      {
        title: '10. Suporte técnico',
        paragraphs: [
          'Questões sobre produto, preço, preparo, entrega, cancelamento e qualidade devem ser tratadas com o restaurante. Problemas especificamente relacionados ao funcionamento da tecnologia KÔMA podem ser encaminhados pelos canais oficiais da plataforma, sem retirar do restaurante sua responsabilidade como fornecedor da compra.',
        ],
      },
    ],
  },
  {
    slug: 'cardapio-privacidade',
    title: 'Aviso de Privacidade do Cardápio Digital',
    shortTitle: 'Privacidade do Cardápio',
    summary: 'Como dados do consumidor são usados para receber, executar, pagar, entregar e acompanhar pedidos.',
    audience: 'Consumidores dos restaurantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Quem decide sobre os dados',
        paragraphs: [
          'Para os dados do pedido e relacionamento com o consumidor, o restaurante identificado no cardápio normalmente atua como Controlador, porque decide o que vende, como atende, quais informações operacionais precisa e por quanto tempo deve manter determinados registros.',
          'O KÔMA atua como Operador ao processar esses dados para fornecer a plataforma ao restaurante. O KÔMA também pode atuar como Controlador independente para tratamentos próprios e limitados, como segurança da aplicação, prevenção a fraude, registros técnicos e defesa de direitos.',
          'Para serviços financeiros, o Mercado Pago ou outro provedor de pagamento pode atuar como controlador independente em atividades exigidas por sua própria relação com pagadores e vendedores.',
        ],
      },
      {
        title: '2. Dados do pedido',
        bullets: [
          'Nome e informações de contato informadas no checkout.',
          'E-mail quando necessário ao pagamento ou atendimento.',
          'Endereço e referências quando houver entrega.',
          'Itens, valores, observações, modalidade de atendimento e histórico necessário à execução do pedido.',
          'Identificadores, QR Code e status do pagamento quando houver Pix online.',
          'IP, User-Agent, sessão e registros técnicos necessários para segurança, prevenção a duplicidade e diagnóstico.',
        ],
      },
      {
        title: '3. Finalidades e bases legais',
        bullets: [
          'Receber, confirmar, preparar, cobrar, entregar e prestar atendimento sobre o pedido: execução do contrato de compra e procedimentos relacionados.',
          'Autenticar sessão, evitar pedidos duplicados, fraude e abuso: legítimo interesse, segurança e prevenção a fraude, conforme aplicável.',
          'Manter registros para conciliação, suporte, obrigação legal e defesa de direitos: obrigação legal, exercício regular de direitos e legítimo interesse compatível.',
          'Processar Pix e reembolsos: execução da compra e obrigações próprias do provedor de pagamento.',
        ],
      },
      {
        title: '4. Dados sensíveis em observações',
        paragraphs: [
          'Informações sobre alergia ou outra condição de saúde podem ser dados pessoais sensíveis. Utilize o campo de observação somente quando essa informação for realmente necessária à preparação segura do pedido e evite registrar detalhes de saúde sem relação com a compra.',
          'O restaurante e o KÔMA não devem utilizar essas informações para publicidade, perfilamento comercial ou finalidade incompatível com o atendimento solicitado.',
        ],
      },
      {
        title: '5. Compartilhamentos',
        paragraphs: [
          'Os dados podem ser acessados pelos usuários autorizados do restaurante e pelos fornecedores tecnológicos estritamente necessários à operação. Pagamentos online envolvem o provedor financeiro; notificações por WhatsApp envolvem a infraestrutura de mensagens quando essa funcionalidade estiver ativa.',
          'A lista pública de fornecedores do KÔMA identifica infraestrutura, região conhecida e finalidade. O restaurante pode possuir fornecedores próprios adicionais, como entregadores ou ferramentas externas, pelos quais é responsável no âmbito de suas decisões.',
        ],
      },
      {
        title: '6. Transferências internacionais',
        paragraphs: [
          'O KÔMA utiliza atualmente infraestrutura de backend e banco de dados nos Estados Unidos e rede global de entrega de conteúdo. Por isso, dados do pedido podem ser processados fora do Brasil. As transferências devem observar os mecanismos permitidos pela LGPD e pela regulamentação da ANPD, sem reduzir os direitos do titular no Brasil.',
        ],
      },
      {
        title: '7. Crianças e adolescentes',
        paragraphs: [
          'O cardápio pode ser acessado por crianças e adolescentes. Os agentes responsáveis devem tratar seus dados no melhor interesse, coletar apenas o necessário e apresentar informações de maneira adequada à idade quando aplicável.',
          'Quando a legislação exigir participação ou consentimento do responsável legal para determinado tratamento de dados de criança, o restaurante e a plataforma deverão adotar o mecanismo correspondente antes de depender desse tratamento. Itens impróprios ou proibidos para menores exigem controles de idade específicos e não podem depender apenas de autodeclaração.',
        ],
      },
      {
        title: '8. Retenção',
        paragraphs: [
          'Os dados são mantidos pelo tempo necessário à execução do pedido, atendimento, conciliação, segurança, obrigações legais e defesa de direitos. O restaurante define retenções relacionadas à sua venda, observada a legislação; o KÔMA aplica as retenções técnicas e contratuais descritas em sua Política de Privacidade e no DPA.',
        ],
      },
      {
        title: '9. Direitos e contato',
        paragraphs: [
          'O consumidor pode solicitar confirmação, acesso, correção e demais direitos previstos na LGPD ao restaurante quando o pedido estiver sob seu controle. O contato do estabelecimento deve estar disponível no cardápio.',
          'Para dúvidas ou direitos relacionados especificamente a tratamentos próprios do KÔMA, o titular pode utilizar o canal oficial de privacidade divulgado na Central Legal. Quando receber pedido que pertença ao restaurante, o KÔMA poderá encaminhar ou orientar o titular ao Controlador adequado.',
        ],
      },
      {
        title: '10. Segurança',
        paragraphs: [
          'O KÔMA utiliza controles de segregação entre restaurantes, autorização, criptografia de credenciais sensíveis, TLS em trânsito, validações de acesso e mecanismos para reduzir duplicidade e fraude. O restaurante deve igualmente limitar acessos de sua equipe e proteger os dispositivos usados na operação.',
        ],
      },
    ],
  },
];

export function findLegalDocument(slug: string | undefined): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
