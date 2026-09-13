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

export const LEGAL_VERSION = '2.0';
export const LEGAL_EFFECTIVE_DATE = '13/09/2026';
export const LEGAL_PROVIDER_NAME = 'Georlan Gomes e Silva Júnior';
export const LEGAL_PROVIDER_LOCATION = 'Limoeiro do Norte/CE';
export const LEGAL_SUPPORT_SCHEDULE = 'todos os dias, das 09h às 23h, no horário de Brasília';

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: 'termos',
    title: 'Termos de Contratação e Uso do KÔMA',
    shortTitle: 'Termos de Contratação',
    summary: 'Contrato principal do KÔMA para restaurantes e demais estabelecimentos que utilizam a plataforma na própria atividade.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Identificação das partes e formação do contrato',
        paragraphs: [
          `O KÔMA é uma plataforma de software como serviço operada, nesta versão contratual, por ${LEGAL_PROVIDER_NAME}, estabelecido em ${LEGAL_PROVIDER_LOCATION}. A identificação fiscal completa, o endereço e os canais oficiais do prestador constam do fluxo de contratação e do Comprovante Individual da Contratação, sem necessidade de exposição de documento fiscal pessoal no código-fonte público.`,
          'O contratante é a pessoa física ou jurídica identificada no fluxo de contratação. Quem aceita estes documentos em nome de estabelecimento ou pessoa jurídica declara possuir poderes ou autorização suficientes para contratar e assume a responsabilidade pela veracidade dos dados informados.',
          'Integram o contrato o Comprovante Individual da Contratação, estes Termos, as Condições Comerciais aceitas e o Anexo de Tratamento de Dados Pessoais (DPA). Políticas e avisos de privacidade complementam a transparência sobre os tratamentos de dados.',
        ],
      },
      {
        title: '2. Natureza empresarial e normas obrigatórias',
        paragraphs: [
          'O KÔMA é oferecido principalmente como ferramenta utilizada na atividade profissional ou empresarial do estabelecimento. Essa qualificação não exclui normas de ordem pública que sejam obrigatoriamente aplicáveis ao caso concreto, inclusive normas de defesa do consumidor quando presentes os respectivos requisitos legais.',
          'Em caso de divergência econômica entre textos gerais e o Comprovante Individual da Contratação, prevalecem o plano, o ciclo, o preço fixo, a taxa percentual e as condições individualmente registradas no aceite, sem prejuízo de direitos legais indisponíveis.',
        ],
      },
      {
        title: '3. Objeto, módulos e licença de uso',
        paragraphs: [
          'O KÔMA fornece tecnologia para apoiar a operação e a gestão do estabelecimento. Conforme o plano contratado e os recursos efetivamente habilitados, a plataforma pode abranger mesas, comandas, balcão, caixa, cardápio digital, retirada, delivery, produção, KDS, impressão operacional, estoque, fichas técnicas, equipe, clientes, relatórios, entregadores, fidelização e integrações de pagamento.',
          'A existência técnica de um módulo no software não significa que ele esteja incluído em todos os planos ou homologado para uso comercial. Os recursos contratados são os descritos nas Condições Comerciais e na oferta apresentada antes do aceite.',
          'Durante a vigência, o contratante recebe licença limitada, não exclusiva, intransferível e não sublicenciável para uso do KÔMA em sua própria operação. Não há cessão de código-fonte, marca, arquitetura, métodos, documentação interna ou demais ativos intelectuais.',
        ],
      },
      {
        title: '4. Conta, equipe e segurança de acesso',
        bullets: [
          'O contratante deve manter cadastro, contatos e responsáveis atualizados.',
          'O contratante administra os acessos de sua equipe e deve remover usuários que deixem de precisar do sistema.',
          'Credenciais, tokens e sessões não devem ser compartilhados de forma indevida.',
          'O KÔMA pode invalidar sessões, exigir nova autenticação ou bloquear acessos diante de risco de fraude, comprometimento de credenciais ou ameaça à segurança.',
          'A segregação de acessos por restaurante e por função não elimina a responsabilidade do contratante pelos dispositivos e credenciais sob seu controle.',
        ],
      },
      {
        title: '5. Responsabilidades do estabelecimento',
        bullets: [
          'Manter corretos produtos, preços, descrições, imagens, ingredientes, disponibilidade, horários, áreas e taxas de entrega.',
          'Responder pela venda, preparo, qualidade, higiene, segurança sanitária, retirada, entrega e atendimento ao consumidor.',
          'Cumprir as obrigações fiscais, sanitárias, trabalhistas, consumeristas e regulatórias próprias de sua atividade.',
          'Classificar e tratar corretamente produtos sujeitos a restrição etária ou outra limitação legal.',
          'Conservar fora da plataforma os documentos cuja guarda a lei imponha diretamente ao estabelecimento quando necessário.',
          'Não utilizar o KÔMA para fraude, atividade ilícita, ataque, violação de direitos ou comercialização proibida.',
        ],
      },
      {
        title: '6. Cardápio digital e pedidos',
        paragraphs: [
          'O cardápio digital é uma ferramenta tecnológica utilizada pelo estabelecimento para apresentar sua oferta e receber pedidos. O restaurante continua responsável pelas informações comerciais publicadas, pela oferta, pelos alimentos e pela relação de consumo relativa aos produtos vendidos.',
          'O KÔMA pode aplicar validações, idempotência, regras de segurança, limites técnicos e mecanismos antifraude e pode disponibilizar estados de pedido como criado, aceito, rejeitado, em preparo, pronto, despachado e concluído.',
          'O WhatsApp não é requisito para o consumidor realizar uma compra quando o checkout próprio do cardápio estiver disponível.',
        ],
      },
      {
        title: '7. Produtos sujeitos a restrição etária',
        paragraphs: [
          'O estabelecimento não pode utilizar o KÔMA para concluir venda ilegal de produto proibido ou sujeito a controle especial.',
          'Quando a legislação exigir mecanismo confiável de verificação de idade além de simples autodeclaração, a conclusão online de itens restritos somente poderá ser habilitada quando houver mecanismo tecnicamente e juridicamente adequado. Na ausência desse mecanismo, o KÔMA poderá bloquear ou limitar a venda online do item sem caracterizar descumprimento contratual.',
          'O restaurante permanece responsável pela classificação correta do produto e pela verificação exigida no fornecimento ou entrega quando essa obrigação lhe couber.',
        ],
      },
      {
        title: '8. Pagamentos de consumidores e papel do provedor',
        paragraphs: [
          'Quando habilitado, o KÔMA integra pedidos a provedor externo de pagamento. Autorização, processamento financeiro, liquidação, regras antifraude, chargeback e demais atividades próprias do serviço de pagamento seguem também os termos do provedor.',
          'O restaurante pode precisar manter conta própria no provedor e autorizar a integração por OAuth ou mecanismo equivalente. O KÔMA não oferece conta de pagamento, não concede crédito e não mantém em custódia o valor integral da venda do restaurante.',
          'Quando o provedor suportar divisão automática, poderá separar na própria transação a parcela destinada ao estabelecimento, as tarifas do provedor e a remuneração devida ao KÔMA.',
        ],
      },
      {
        title: '9. Taxa KÔMA sobre pagamentos online',
        paragraphs: [
          'Quando prevista no plano, a taxa percentual do KÔMA incide sobre o valor bruto de pagamentos online elegíveis aprovados no fluxo integrado, conforme percentual registrado no Comprovante Individual da Contratação.',
          'A taxa do KÔMA é independente das tarifas cobradas pelo provedor de pagamento. Pagamentos fora do fluxo online elegível não geram essa taxa, salvo contratação expressa em sentido diferente.',
          'Estornos, cancelamentos e chargebacks obedecem também ao funcionamento do provedor. Quando houver split, a devolução das parcelas pode depender do saldo e das regras das contas participantes; eventual limitação técnica não elimina a responsabilidade do estabelecimento perante seu consumidor pelo valor que lhe corresponda.',
        ],
      },
      {
        title: '10. Contratação do SaaS, recorrência e liberação',
        paragraphs: [
          'A contratação pode exigir autorização prévia de meio de pagamento recorrente suportado. A autorização, isoladamente, não representa cobrança da mensalidade, pagamento confirmado, aprovação definitiva do cadastro nem liberação automática do ambiente.',
          'Por segurança, homologação, prevenção a fraude ou procedimento operacional, o KÔMA pode exigir liberação administrativa antes do provisionamento do restaurante. Se uma sincronização indispensável com o provedor de pagamento falhar, a ativação pode permanecer pendente até a regularização.',
          'Os métodos recorrentes atualmente modelados para novas contratações são cartão e Pix Automático, sujeitos à homologação e disponibilidade do provedor. Pix avulso antecipado não integra o checkout de novas assinaturas SaaS.',
        ],
      },
      {
        title: '11. Teste gratuito',
        paragraphs: [
          'Salvo oferta individual diferente, a nova contratação elegível recebe 7 dias de teste sem cobrança do componente fixo. O teste começa somente na efetiva liberação do restaurante.',
          'Durante o teste, pagamentos online reais processados pelo sistema podem gerar a taxa percentual do plano e tarifas do respectivo provedor. A primeira cobrança automática do componente fixo somente deve ocorrer após o término do teste.',
          'O contratante pode cancelar a recorrência antes da primeira cobrança. O cancelamento durante o trial impede cobranças fixas futuras, sem apagar valores transacionais legitimamente gerados.',
        ],
      },
      {
        title: '12. Cobrança, renovação e inadimplência',
        paragraphs: [
          'Valores, ciclo de cobrança e reajustes constam das Condições Comerciais e do Comprovante Individual da Contratação. A modalidade mensal renova mensalmente até o cancelamento; a modalidade anual renova a cada 12 meses enquanto a recorrência permanecer ativa.',
          'O valor mensal equivalente exibido para o plano anual é referência comparativa e não significa parcelamento em 12 cobranças.',
          'Havendo atraso, aplica-se a tolerância descrita nas Condições Comerciais. A suspensão por inadimplência deve ser reversível após regularização e não autoriza exclusão imediata dos dados.',
        ],
      },
      {
        title: '13. Documentos operacionais, fiscalidade e contabilidade',
        paragraphs: [
          'O estabelecimento é responsável por apurar e cumprir suas próprias obrigações tributárias e fiscais. Salvo indicação expressa de módulo fiscal específico devidamente homologado e contratado, o KÔMA não realiza a emissão fiscal da venda do restaurante.',
          'Comandas, pedidos, conferências de mesa, impressões de cozinha, fechamentos, históricos SmartPOS, relatórios e demais comprovantes operacionais do KÔMA são documentos não fiscais e não substituem NFC-e, NF-e, NFS-e, CF-e ou outro documento fiscal legalmente exigido.',
          'A importação de XML, número ou informação de nota para estoque não significa emissão, escrituração, validação tributária ou contábil pelo KÔMA. Relatórios, DRE de vendas e controles financeiros têm finalidade gerencial e não constituem consultoria contábil, fiscal ou jurídica.',
          'Quanto à própria assinatura do KÔMA, o prestador emitirá os comprovantes e documentos fiscais ou equivalentes que sejam exigíveis segundo seu enquadramento jurídico e tributário vigente.',
        ],
      },
      {
        title: '14. Hardware, impressão e SmartPOS',
        paragraphs: [
          'Impressoras, terminais, SmartPOS e aplicativos auxiliares dependem de hardware compatível, sistema operacional, rede, configuração e disponibilidade do fornecedor. A existência de simulador, bridge de desenvolvimento ou código experimental não significa homologação para uso comercial.',
          'Somente integrações identificadas pelo KÔMA como disponíveis em produção e, quando necessário, incluídas no plano ou contratação específica são parte efetiva do serviço contratado.',
        ],
      },
      {
        title: '15. Dados pessoais e LGPD',
        paragraphs: [
          'O tratamento de dados pessoais observa a legislação aplicável e o DPA. Em regra, para dados de consumidores, pedidos, endereços, clientes e operação tratados segundo decisões do estabelecimento, o restaurante atua como Controlador e o KÔMA como Operador.',
          'O KÔMA atua como Controlador independente apenas nos tratamentos em que define finalidade própria, como gestão contratual, cobrança da assinatura, segurança, prevenção a fraude, suporte, comprovação de aceite, cumprimento de obrigação legal e exercício regular de direitos.',
          'Quando o restaurante atuar como operador de outro controlador, o KÔMA poderá atuar como suboperador na extensão aplicável.',
        ],
      },
      {
        title: '16. Dados sensíveis em observações',
        paragraphs: [
          'Campos de observação podem receber informação de alergia, intolerância ou outra condição de saúde quando o consumidor voluntariamente a informar por ser necessária à preparação segura do pedido.',
          'O estabelecimento deve limitar o uso ao pedido correspondente e não deve inserir ou incentivar a inserção de dados sensíveis sem relação com a finalidade operacional. O KÔMA pode aplicar minimização, acesso restrito e regras de retenção adequadas ao risco.',
        ],
      },
      {
        title: '17. Suboperadores e transferências internacionais',
        paragraphs: [
          'O KÔMA utiliza fornecedores de infraestrutura, banco de dados, armazenamento, entrega de conteúdo, e-mail, mensagens, pagamentos, fontes e monitoramento, conforme documento público de Suboperadores e Transferências.',
          'Alguns tratamentos podem ocorrer fora do Brasil. Quando houver transferência internacional de dados pessoais, serão adotados os mecanismos aplicáveis da LGPD e da regulamentação da ANPD, com transparência sobre finalidade, país ou região, agentes envolvidos e direitos dos titulares.',
        ],
      },
      {
        title: '18. Segurança e incidentes',
        paragraphs: [
          'O KÔMA adota medidas técnicas e administrativas razoáveis e proporcionais aos riscos, incluindo segregação de tenants, controle de acesso, proteção de credenciais, criptografia aplicável, idempotência em fluxos críticos e procedimentos de resposta a incidentes.',
          'Nenhum serviço conectado à internet oferece risco zero. O KÔMA pode restringir temporariamente funcionalidades para conter vulnerabilidade, fraude, indisponibilidade crítica ou incidente.',
          'Incidentes envolvendo dados pessoais serão avaliados e comunicados conforme a LGPD, as normas da ANPD, o DPA e o procedimento interno aplicável.',
        ],
      },
      {
        title: '19. Conteúdo, propriedade intelectual e confidencialidade',
        paragraphs: [
          'O contratante mantém os direitos que possuir sobre seus dados, marcas, cardápios, fotografias e demais conteúdos. Concede ao KÔMA apenas a licença necessária para hospedar, processar, exibir e transmitir esse conteúdo para executar o serviço.',
          'O contratante declara possuir autorização para os conteúdos que inserir. Cada parte deve proteger informações confidenciais recebidas da outra e utilizá-las apenas para execução do contrato, segurança, suporte, cumprimento legal ou exercício de direitos.',
        ],
      },
      {
        title: '20. Disponibilidade, manutenção e suporte',
        paragraphs: [
          `O atendimento humano padrão é oferecido ${LEGAL_SUPPORT_SCHEDULE}, pelos canais oficiais divulgados pelo KÔMA. Atendimento prioritário significa preferência na fila, não garantia absoluta de solução em prazo determinado.`,
          'O KÔMA emprega esforços razoáveis para manter o serviço disponível e seguro, mas não oferece percentual mínimo de uptime salvo contratação específica. Internet, energia, navegador, dispositivos e serviços de terceiros podem afetar funcionalidades.',
          'Manutenções planejadas serão comunicadas quando razoavelmente possível. Correções emergenciais de segurança, fraude ou indisponibilidade crítica podem ocorrer sem aviso prévio.',
        ],
      },
      {
        title: '21. Suspensão por risco ou uso proibido',
        paragraphs: [
          'O KÔMA pode suspender imediatamente conta ou funcionalidade diante de indícios razoáveis de fraude, ataque, violação grave da lei, comercialização proibida, manipulação de pagamentos ou risco concreto a outros clientes e sistemas.',
          'Sempre que possível, a medida será proporcional ao risco e revista após a apuração. A suspensão não elimina automaticamente obrigações financeiras já constituídas nem autoriza exclusão indiscriminada de dados.',
        ],
      },
      {
        title: '22. Cancelamento, encerramento e exportação',
        paragraphs: [
          'O contratante pode cancelar a recorrência pelos meios disponibilizados pelo KÔMA. O cancelamento interrompe renovações futuras e segue as regras econômicas do ciclo contratado nas Condições Comerciais.',
          'Após o encerramento, o restaurante terá janela de até 30 dias para solicitar ou utilizar os meios disponibilizados de exportação dos dados próprios, salvo prazo diferente exigido por lei ou oferta específica.',
          'Depois dessa janela, dados podem ser eliminados ou anonimizados, preservados apenas quando necessários para obrigação legal, segurança, prevenção a fraude, comprovação contratual, cobrança ou exercício regular de direitos. Backups técnicos seguem seus ciclos seguros de sobrescrita.',
        ],
      },
      {
        title: '23. Responsabilidade e limites',
        paragraphs: [
          'O restaurante é o fornecedor dos produtos e serviços vendidos a seus consumidores. O KÔMA responde pela tecnologia sob seu controle e não substitui as responsabilidades do estabelecimento por alimentos, tributos, equipe, logística ou atendimento.',
          'Na máxima extensão permitida pela lei, nenhuma parte responde por danos indiretos, lucros cessantes hipotéticos ou perda de oportunidade que não sejam consequência direta e previsível do descumprimento.',
          'Em relação estritamente empresarial e quando juridicamente válida, a responsabilidade patrimonial agregada do KÔMA por danos diretos decorrentes do contrato fica limitada ao total efetivamente pago ao KÔMA nos 12 meses anteriores ao evento. A limitação não se aplica quando a lei proibir a exclusão ou limitação, inclusive em hipóteses de dolo, culpa grave, dano à integridade física, violação intencional de propriedade intelectual ou responsabilidades cogentes de proteção de dados e defesa do consumidor.',
        ],
      },
      {
        title: '24. Evolução do serviço e alterações jurídicas',
        paragraphs: [
          'O KÔMA pode evoluir interfaces, fluxos e funcionalidades. Redução material de recurso incluído no plano, alteração econômica extraordinária ou mudança contratual relevante será comunicada, quando possível, com antecedência razoável e poderá exigir novo aceite.',
          'Mudanças urgentes exigidas por lei, segurança, fraude, vulnerabilidade crítica ou dependência de terceiro podem entrar em vigor em prazo menor.',
          'Cada versão jurídica possui identificação e data. A publicação de versão futura não apaga a versão que regia fatos anteriores.',
        ],
      },
      {
        title: '25. Aceite eletrônico e evidências',
        paragraphs: [
          'A contratação pode ser concluída eletronicamente. O KÔMA pode registrar versão e hash dos documentos, plano, ciclo, preço, taxa percentual, identidade do contratante e representante, data e hora, sessão, IP, User-Agent e outros elementos proporcionais necessários à segurança e à comprovação do negócio.',
          'O Comprovante Individual da Contratação deve permitir ao contratante conservar e reproduzir as condições principais aceitas.',
        ],
      },
      {
        title: '26. Comunicações, cessão e lei aplicável',
        paragraphs: [
          'O e-mail cadastrado pelo administrador é o canal principal para comunicações contratuais relevantes. WhatsApp pode ser usado como canal complementar de suporte e avisos operacionais.',
          'O KÔMA pode transferir a operação contratual para pessoa jurídica que venha a assumir formalmente a plataforma ou em reorganização empresarial, com preservação dos direitos essenciais e atualização da identificação jurídica.',
          'O contrato é regido pelas leis brasileiras. Em relações estritamente empresariais e quando a eleição for juridicamente válida, fica eleito o foro de Limoeiro do Norte/CE, sem afastar competência obrigatória ou direitos cogentes aplicáveis.',
        ],
      },
    ],
  },
  {
    slug: 'planos',
    title: 'Condições Comerciais dos Planos KÔMA',
    shortTitle: 'Condições Comerciais',
    summary: 'Preços, recursos, recorrência, trial, taxa sobre pagamentos online, reajuste, mudança de plano, inadimplência e cancelamento.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Catálogo e preços',
        bullets: [
          'Pocket: R$ 109 por mês + 1,49% sobre pagamentos online aprovados elegíveis.',
          'Pro: R$ 209 por mês + 0,69% sobre pagamentos online aprovados elegíveis.',
          'Premium: R$ 309 por mês + 0,29% sobre pagamentos online aprovados elegíveis.',
          'Não há taxa de implantação nem add-on obrigatório no catálogo padrão desta versão.',
          'Tarifas cobradas pelo provedor de pagamento são separadas da taxa KÔMA.',
        ],
      },
      {
        title: '2. KÔMA Pocket',
        bullets: [
          'Mesas, comandas e balcão.',
          'Cardápio digital e QR Code com pedidos no PDV.',
          'Retirada e delivery no mesmo caixa.',
          'Fila de preparo na tela, sem impressão automática.',
          'Caixa, fechamento e resumo de vendas.',
          'Clientes e histórico de pedidos.',
          'Não inclui KDS dedicado e impressão automática, estoque/fichas técnicas/financeiro completo, app do entregador ou fidelidade.',
        ],
      },
      {
        title: '3. KÔMA Pro',
        bullets: [
          'Inclui todos os recursos do Pocket.',
          'KDS e impressão automática quando a infraestrutura compatível estiver configurada.',
          'Estoque, fichas técnicas e financeiro.',
          'Garçom web e permissões de equipe.',
          'Relatórios gerenciais completos.',
          'Não inclui app do entregador nem pontos, cashback e cupons.',
        ],
      },
      {
        title: '4. KÔMA Premium',
        bullets: [
          'Inclui todos os recursos do Pro.',
          'Inclui app do entregador.',
          'Inclui pontos, cashback e cupons.',
          'Inclui suporte prioritário dentro da janela oficial de atendimento.',
        ],
      },
      {
        title: '5. Modalidade anual',
        paragraphs: [
          'Na modalidade anual, o componente fixo corresponde a 12 mensalidades com desconto de 10%. Valores de referência desta versão: Pocket R$ 1.177,20; Pro R$ 2.257,20; Premium R$ 3.337,20.',
          'O valor mensal equivalente é apenas comparativo. A autorização do meio recorrente ocorre antes da liberação, mas a cobrança anual somente ocorre após o término dos 7 dias grátis e se renova a cada 12 meses até o cancelamento.',
          'O desconto anual aplica-se somente ao componente fixo. A taxa percentual sobre pagamentos online permanece a mesma do plano. Não existem dias adicionais de bônus em substituição ao trial.',
        ],
      },
      {
        title: '6. Autorização recorrente e métodos de pagamento',
        paragraphs: [
          'Toda nova contratação publicada no checkout deve utilizar meio recorrente homologado. Os métodos atualmente modelados são cartão de crédito e Pix Automático, sujeitos à disponibilidade do provedor.',
          'A autorização não cobra o componente fixo no ato e não garante liberação imediata. Pix avulso ou QR Code antecipado não é método válido para novas assinaturas SaaS.',
          'Métodos adicionais só podem ser anunciados quando suportarem a mesma regra canônica de autorização recorrente, trial e cobrança posterior.',
        ],
      },
      {
        title: '7. Teste gratuito de 7 dias',
        paragraphs: [
          'Salvo oferta individual diferente, toda nova contratação elegível recebe 7 dias grátis no componente fixo, contados da efetiva liberação do restaurante.',
          'Pagamentos online reais processados durante o teste continuam sujeitos à taxa percentual do plano e às tarifas do provedor.',
          'O cancelamento da recorrência antes do fim do trial impede a primeira cobrança fixa.',
        ],
      },
      {
        title: '8. Taxa sobre pagamentos online',
        paragraphs: [
          'A taxa KÔMA incide sobre o valor bruto de cada pagamento online aprovado e elegível no fluxo integrado. O backend utiliza o plano registrado para determinar o percentual aplicável.',
          'A taxa não se aplica automaticamente a dinheiro, cartão presencial, Pix externo ou outras formas processadas fora do fluxo online elegível.',
          'Quando disponível, a divisão pode ocorrer automaticamente pelo provedor. Reembolsos e chargebacks seguem também as regras técnicas e financeiras do provedor.',
        ],
      },
      {
        title: '9. Upgrade, downgrade e alterações do catálogo',
        paragraphs: [
          'Mudanças de plano podem produzir efeito funcional imediato ou na data indicada na confirmação. Qualquer ajuste financeiro aplicável deve ser informado antes da confirmação.',
          'Recursos legados podem ser preservados temporariamente por compatibilidade técnica sem criar direito permanente a catálogo antigo não contratado.',
          'Alteração extraordinária de preço ou redução material de recurso será comunicada com antecedência razoável, permitindo cancelamento antes da vigência quando aplicável.',
        ],
      },
      {
        title: '10. Reajuste',
        paragraphs: [
          'O componente fixo pode ser reajustado após 12 meses, tomando o IPCA como referência, salvo condição específica mais favorável.',
          'Mudanças extraordinárias não enquadradas no reajuste periódico serão comunicadas previamente e não alteram retroativamente valores já pagos.',
        ],
      },
      {
        title: '11. Inadimplência',
        paragraphs: [
          'Após o vencimento existe tolerância de 5 dias corridos. Persistindo o atraso, o KÔMA pode suspender de forma reversível funcionalidades operacionais até a regularização.',
          'Se a inadimplência ultrapassar 30 dias corridos, o contrato poderá ser encerrado após comunicação ao contato oficial, preservadas a janela de exportação e as retenções legalmente necessárias.',
          'A suspensão por inadimplência não autoriza hard delete imediato dos dados.',
        ],
      },
      {
        title: '12. Cancelamento mensal e anual',
        paragraphs: [
          'No mensal, o cancelamento impede nova renovação e preserva o acesso até o fim do período já pago, sem restituição proporcional do ciclo iniciado, salvo obrigação legal ou solução devida por falha imputável ao KÔMA.',
          'No anual, em caso de cancelamento antecipado após cobrança, o período já utilizado será recalculado pelo preço mensal normal do plano; frações de mês podem ser calculadas pro rata em base de 30 dias. O saldo positivo remanescente será restituído e o recálculo não criará dívida adicional apenas pelo cancelamento.',
          'Taxas transacionais já geradas por pagamentos online efetivamente processados não integram a restituição do componente fixo.',
        ],
      },
      {
        title: '13. Promoções e oferta individual',
        paragraphs: [
          'Promoção válida deve ser identificada antes do aceite e constar do Comprovante Individual da Contratação quando alterar preço, prazo ou benefício.',
          'Promoções não alteram permanentemente o preço-base do catálogo e não se acumulam salvo previsão expressa.',
        ],
      },
    ],
  },
  {
    slug: 'privacidade',
    title: 'Política de Privacidade do KÔMA',
    shortTitle: 'Privacidade do SaaS',
    summary: 'Como o KÔMA trata dados de contratantes, representantes, equipe, leads, suporte e segurança da plataforma.',
    audience: 'Contratantes, representantes, usuários da equipe e interessados no KÔMA',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Escopo e papéis',
        paragraphs: [
          'Esta Política explica os tratamentos em que o KÔMA atua como Controlador, especialmente contratação, cobrança do SaaS, segurança, suporte, prevenção a fraude, comunicações e gestão de usuários.',
          'Para dados de consumidores e pedidos tratados em nome do restaurante, consulte também o DPA e a Política de Privacidade do Cardápio. Nesses fluxos, em regra, o restaurante é Controlador e o KÔMA é Operador.',
        ],
      },
      {
        title: '2. Dados de interessados e inscrição',
        bullets: [
          'Nome do restaurante, nome do responsável, e-mail, WhatsApp e dados de contato informados no fluxo de inscrição.',
          'Plano, ciclo e etapa do onboarding.',
          'Rascunho de inscrição e identificadores técnicos necessários para retomada segura.',
          'O token de retomada é mantido no navegador; o backend armazena seu hash e protege dados de contato de acordo com a arquitetura vigente.',
          'Rascunhos não concluídos podem expirar após 30 dias, observadas retenções necessárias à segurança e defesa de direitos.',
        ],
      },
      {
        title: '3. Dados de contratação e cobrança',
        bullets: [
          'Nome ou razão social, CPF/CNPJ do contratante e dados do representante.',
          'Plano, ciclo, preço, taxa percentual, versão e hash dos documentos aceitos.',
          'Data, hora, IP, User-Agent, sessão e evidências proporcionais do aceite.',
          'Identificadores de assinatura, autorização recorrente, fatura e status recebidos do provedor de pagamento.',
          'O KÔMA não precisa receber ou armazenar o número completo do cartão quando o dado é coletado diretamente pelo provedor de pagamento.',
        ],
      },
      {
        title: '4. Dados de usuários da equipe',
        bullets: [
          'Nome, login, contato quando aplicável, função, cargo e permissões.',
          'Restaurante ao qual o usuário pertence, sessões, autenticação, registros de segurança e auditoria.',
          'Dados necessários para recuperar acesso, investigar abuso e aplicar segregação entre estabelecimentos.',
        ],
      },
      {
        title: '5. Suporte, comunicações e notificações',
        paragraphs: [
          'Podemos tratar mensagens, anexos, contatos e histórico de atendimento enviados aos canais oficiais para responder solicitações, resolver incidentes e manter registro da relação.',
          'E-mail e WhatsApp podem ser usados para comunicações contratuais e operacionais. Marketing promocional não será presumido como autorizado apenas pela contratação e deve observar a base legal e as opções de oposição aplicáveis.',
        ],
      },
      {
        title: '6. Dados técnicos e segurança',
        bullets: [
          'Endereço IP, User-Agent, data e hora, identificadores de sessão e eventos de autenticação.',
          'Logs de aplicação, erros, métricas técnicas e trilhas de auditoria na medida necessária à segurança, disponibilidade e investigação de incidentes.',
          'Informações de dispositivo e navegador indispensáveis ao funcionamento e à prevenção a fraude.',
        ],
      },
      {
        title: '7. Finalidades e bases legais',
        paragraphs: [
          'Os dados podem ser tratados para executar contrato ou procedimentos relacionados, cumprir obrigação legal ou regulatória, exercer direitos, proteger a vida ou a incolumidade quando aplicável, atender interesse legítimo compatível de segurança e melhoria do serviço ou mediante consentimento quando essa for a base apropriada.',
          'O KÔMA busca limitar cada tratamento ao necessário para sua finalidade e não utiliza consentimento para encobrir tratamentos que dependam de outra base legal obrigatória.',
        ],
      },
      {
        title: '8. Compartilhamento e fornecedores',
        paragraphs: [
          'Dados podem ser compartilhados com fornecedores estritamente necessários à hospedagem, banco de dados, armazenamento, entrega de conteúdo, pagamentos, e-mail, mensageria, fontes, monitoramento e suporte, respeitados os papéis de cada agente.',
          'A lista pública de Suboperadores e Transferências identifica os principais serviços usados pelo KÔMA e indica quando a ativação é condicional.',
        ],
      },
      {
        title: '9. Transferências internacionais',
        paragraphs: [
          'Parte da infraestrutura pode estar localizada fora do Brasil. O KÔMA adota ou deve adotar o mecanismo de transferência internacional aplicável, conforme a LGPD e a regulamentação da ANPD, e mantém transparência sobre finalidade, destino e agentes envolvidos.',
          'A transferência internacional não elimina a aplicação das obrigações de proteção de dados que incidam sobre o tratamento.',
        ],
      },
      {
        title: '10. Retenção',
        paragraphs: [
          'Os prazos variam conforme a finalidade. Rascunhos de inscrição podem expirar em 30 dias; evidências contratuais, faturamento, auditoria, segurança e registros necessários à defesa de direitos podem ser conservados por prazo superior enquanto houver fundamento legal.',
          'Após o término da finalidade, dados serão eliminados, anonimizados ou mantidos apenas nas hipóteses autorizadas pela legislação. Backups seguem ciclos técnicos de sobrescrita e recuperação.',
        ],
      },
      {
        title: '11. Direitos dos titulares',
        paragraphs: [
          'Titulares podem exercer os direitos previstos na LGPD, incluindo confirmação de tratamento, acesso, correção, anonimização, bloqueio ou eliminação quando cabível, portabilidade nos termos regulamentares, informação sobre compartilhamento, revogação do consentimento quando aplicável e revisão de decisões automatizadas nos limites legais.',
          'Solicitações podem exigir confirmação de identidade proporcional ao risco. Quando o pedido disser respeito a dados tratados em nome de restaurante, o KÔMA poderá direcioná-lo ao respectivo Controlador e prestar a cooperação prevista no DPA.',
        ],
      },
      {
        title: '12. Segurança, incidentes e contato',
        paragraphs: [
          'Adotamos medidas técnicas e administrativas adequadas ao risco, sem prometer segurança absoluta. Incidentes são avaliados conforme a LGPD e as normas da ANPD.',
          'O canal de privacidade vigente é divulgado nos canais oficiais do KÔMA. Enquanto não houver canal dedicado diferente, solicitações podem ser recebidas pelo suporte oficial e encaminhadas ao responsável competente.',
        ],
      },
    ],
  },
  {
    slug: 'dpa',
    title: 'Anexo de Tratamento de Dados Pessoais (DPA)',
    shortTitle: 'Anexo de Dados (DPA)',
    summary: 'Regras entre o restaurante Controlador e o KÔMA Operador para dados processados em nome do estabelecimento.',
    audience: 'Restaurantes contratantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Incorporação e papéis',
        paragraphs: [
          'Este DPA integra os Termos quando o KÔMA trata dados pessoais em nome do restaurante. Para consumidores, pedidos, endereços, clientes e operação processados segundo as decisões do estabelecimento, o restaurante atua como Controlador e o KÔMA como Operador.',
          'Quando o KÔMA define finalidade própria, como segurança, gestão contratual, cobrança da assinatura e comprovação de aceite, atua como Controlador independente somente para esses tratamentos.',
        ],
      },
      {
        title: '2. Objeto, duração e instruções',
        paragraphs: [
          'O KÔMA tratará dados durante a vigência e pelo período necessário ao encerramento, exportação, segurança e retenções autorizadas, de acordo com as funcionalidades contratadas e as instruções documentadas do restaurante.',
          'Configurações realizadas no painel, uso de APIs, abertura de chamados e decisões operacionais compatíveis com o contrato podem constituir instruções documentadas. O KÔMA informará quando considerar uma instrução manifestamente incompatível com a legislação e poderá suspender sua execução até esclarecimento.',
        ],
      },
      {
        title: '3. Categorias de titulares e dados',
        bullets: [
          'Consumidores e clientes: identificação, contato, endereço, pedidos, preferências operacionais, histórico e dados de pagamento limitados aos metadados necessários.',
          'Equipe do restaurante: identificação, cargo, permissões, autenticação, atividade e auditoria.',
          'Entregadores: identificação, contato e dados operacionais necessários à entrega quando o recurso for utilizado.',
          'Dados sensíveis: informação de alergia, intolerância ou saúde inserida voluntariamente em observação quando necessária à preparação segura do pedido.',
        ],
      },
      {
        title: '4. Finalidades do processamento',
        bullets: [
          'Receber, registrar, preparar, cobrar, entregar e acompanhar pedidos.',
          'Exibir cardápio e operar caixa, mesas, cozinha, estoque, entregas, fidelidade e relatórios conforme o plano.',
          'Autenticar usuários, aplicar permissões, prevenir duplicidade, fraude e abuso.',
          'Prestar suporte, corrigir falhas e permitir exportação e atendimento de direitos dos titulares.',
        ],
      },
      {
        title: '5. Obrigações do restaurante Controlador',
        bullets: [
          'Definir bases legais, transparência e finalidades do tratamento sob seu controle.',
          'Coletar somente dados necessários e manter corretas as informações apresentadas aos consumidores.',
          'Não instruir tratamento ilícito ou incompatível com a finalidade do serviço.',
          'Responder aos titulares e autoridades, com auxílio do KÔMA quando tecnicamente dependente da plataforma.',
          'Gerenciar acessos de sua equipe e proteger os dispositivos sob seu controle.',
        ],
      },
      {
        title: '6. Obrigações do KÔMA Operador',
        bullets: [
          'Tratar dados somente conforme instruções documentadas e para executar o serviço, salvo obrigação legal própria.',
          'Restringir o acesso a pessoas e fornecedores que precisem dos dados para suas funções.',
          'Adotar medidas de segurança proporcionais ao risco e manter deveres de confidencialidade.',
          'Auxiliar o Controlador, na medida das informações disponíveis, em direitos de titulares, segurança, incidentes e avaliações exigíveis.',
          'Eliminar, devolver ou tornar indisponíveis os dados após o término, ressalvadas retenções legalmente autorizadas.',
        ],
      },
      {
        title: '7. Suboperadores',
        paragraphs: [
          'O restaurante autoriza de forma geral o uso dos suboperadores necessários à prestação do KÔMA, identificados no documento público de Suboperadores e Transferências.',
          'O KÔMA deverá impor aos suboperadores obrigações de proteção compatíveis com a função exercida e continuará responsável por suas obrigações próprias como Operador. Mudança material de fornecedor será comunicada por meio razoável quando exigível.',
        ],
      },
      {
        title: '8. Transferências internacionais',
        paragraphs: [
          'Quando um suboperador ou infraestrutura implicar transferência internacional de dados pessoais, o KÔMA adotará o mecanismo aplicável da LGPD e da regulamentação da ANPD e fornecerá ao restaurante as informações razoavelmente disponíveis para sua própria prestação de contas.',
          'O Controlador reconhece que a arquitetura em nuvem pode envolver tratamento fora do Brasil e deverá considerar essa característica em sua própria transparência aos titulares.',
        ],
      },
      {
        title: '9. Segurança e controle de acesso',
        paragraphs: [
          'As medidas podem incluir segregação multi-tenant, autenticação, permissões, proteção de segredos, criptografia aplicável, backups, idempotência, monitoramento, trilhas de auditoria e resposta a incidentes, de acordo com o risco e a arquitetura vigente.',
          'Detalhes que aumentem o risco de abuso podem ser mantidos em documentação interna de segurança e fornecidos sob necessidade legítima e dever de confidencialidade.',
        ],
      },
      {
        title: '10. Incidentes',
        paragraphs: [
          'Após confirmar incidente relevante que afete dados tratados em nome do restaurante, o KÔMA buscará avisar o Controlador sem demora indevida e, como objetivo operacional, em até 24 horas da confirmação quando houver informações suficientes para comunicação útil.',
          'O aviso inicial pode ser complementado posteriormente e conter, na medida disponível, natureza do incidente, categorias de dados, medidas de contenção e ponto de contato. A decisão sobre comunicação obrigatória aos titulares ou à ANPD caberá a quem a lei atribuir essa responsabilidade no caso concreto.',
        ],
      },
      {
        title: '11. Direitos de titulares e cooperação',
        paragraphs: [
          'Quando o atendimento depender tecnicamente do KÔMA, a plataforma buscará cooperar em prazo operacional de até 5 dias úteis, sem substituir os prazos legais do Controlador.',
          'O KÔMA pode exigir informações suficientes para localizar o titular e evitar divulgação indevida a pessoa não autorizada.',
        ],
      },
      {
        title: '12. Auditoria e término',
        paragraphs: [
          'O KÔMA fornecerá informações razoavelmente necessárias para demonstrar cumprimento deste DPA, respeitados segurança, confidencialidade e direitos de terceiros. Auditorias invasivas devem ser previamente coordenadas e proporcionais ao risco.',
          'No término, aplica-se a janela contratual de exportação e, depois dela, eliminação ou anonimização, ressalvadas obrigações legais, segurança, backups e exercício regular de direitos.',
        ],
      },
    ],
  },
  {
    slug: 'suboperadores',
    title: 'Fornecedores, Suboperadores e Transferências do KÔMA',
    shortTitle: 'Suboperadores',
    summary: 'Principais terceiros da arquitetura e transparência sobre transferências internacionais e papéis independentes.',
    audience: 'Contratantes, usuários e titulares',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
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
          'Finalidade: OAuth do restaurante, pagamentos online, Pix, split e cobrança recorrente do SaaS quando habilitados.',
          'Papel: pode atuar como controlador independente para atividades próprias de pagamento e como fornecedor integrado ao KÔMA.',
          'Dados possíveis: identificadores de conta, transação, pagamento, assinatura, comprador e metadados necessários ao fluxo financeiro. Dados completos de cartão podem ser coletados diretamente pelo provedor sem transitar pelo backend do KÔMA.',
        ],
      },
      {
        title: '6. Resend',
        bullets: [
          'Finalidade: envio de e-mails transacionais quando a integração estiver habilitada.',
          'Dados possíveis: destinatário, assunto, conteúdo da mensagem e metadados de entrega necessários ao envio.',
          'A ativação depende da configuração operacional de e-mail do KÔMA.',
        ],
      },
      {
        title: '7. WhatsApp, Meta e conector de mensageria',
        bullets: [
          'Finalidade: suporte, convites e notificações operacionais quando habilitados.',
          'O KÔMA pode utilizar conector auto-hospedado para orquestração e a infraestrutura do WhatsApp/Meta para entrega final das mensagens.',
          'Dados possíveis: número de telefone, conteúdo de mensagem e metadados de entrega.',
        ],
      },
      {
        title: '8. Google Fonts',
        bullets: [
          'Finalidade: carregamento de fontes web utilizadas pela interface enquanto permanecer ativo no frontend.',
          'O navegador pode realizar requisições aos domínios de fontes do Google e transmitir metadados técnicos usuais de rede, como endereço IP e User-Agent.',
          'A dependência pode ser removida ou substituída por hospedagem local sem necessidade de novo aceite quando não houver redução de direitos.',
        ],
      },
      {
        title: '9. Sentry, quando habilitado',
        bullets: [
          'Finalidade: monitoramento de erros e desempenho do backend quando SENTRY_DSN estiver configurado.',
          'Dados possíveis: stack traces, contexto técnico, identificadores de requisição e, somente se explicitamente habilitado, informações adicionais de contexto. O KÔMA busca minimizar dados pessoais no monitoramento.',
          'Se o serviço estiver desabilitado no ambiente, não há envio correspondente apenas pela presença do SDK no código.',
        ],
      },
      {
        title: '10. Transferência internacional e mecanismos',
        paragraphs: [
          'Railway, Supabase, Cloudflare, Google e outros fornecedores internacionais podem implicar transferência internacional. O KÔMA deve manter mecanismo válido de transferência conforme a LGPD e a Resolução CD/ANPD nº 19/2024 ou norma que a substitua.',
          'Quando o mecanismo utilizado depender de cláusulas contratuais, os instrumentos aplicáveis devem ser compatíveis com as cláusulas-padrão ou outro mecanismo reconhecido pela ANPD. Esta página não substitui a formalização contratual necessária.',
        ],
      },
      {
        title: '11. Atualizações',
        paragraphs: [
          'A lista pode mudar conforme a evolução da arquitetura. Inclusões que alterem materialmente o tratamento de dados serão refletidas nesta página e comunicadas quando exigido pela legislação ou pelo DPA.',
        ],
      },
    ],
  },
  {
    slug: 'cookies',
    title: 'Política de Cookies e Armazenamento Local do KÔMA',
    shortTitle: 'Cookies e Armazenamento',
    summary: 'Tecnologias de navegador usadas para autenticação, preferências, segurança e funcionamento.',
    audience: 'Usuários do site, painel e cardápio',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Escopo',
        paragraphs: [
          'Esta Política cobre cookies, localStorage, sessionStorage e tecnologias equivalentes utilizadas pelos domínios e aplicações do KÔMA.',
          'Nem todo armazenamento local é cookie e nem todo dado armazenado no navegador é enviado automaticamente ao servidor.',
        ],
      },
      {
        title: '2. Tecnologias estritamente necessárias',
        bullets: [
          'Autenticação, sessão e continuidade do acesso.',
          'Tokens ou identificadores necessários para retomada segura de fluxos, como inscrição ainda não concluída.',
          'Preferências essenciais da aplicação, incluindo tema e estado de interface quando aplicável.',
          'Proteções de segurança, idempotência e prevenção a abuso.',
        ],
      },
      {
        title: '3. Sessões operacionais',
        paragraphs: [
          'A aplicação pode manter sessões separadas por contexto ou aba para permitir que funções operacionais diferentes coexistam com segurança. O logout, expiração do token e troca de usuário podem remover ou invalidar os respectivos identificadores.',
          'Não é permitido utilizar armazenamento local para contornar permissões, restaurar sessão encerrada indevidamente ou acessar restaurante diferente daquele autorizado.',
        ],
      },
      {
        title: '4. Analíticos e marketing',
        paragraphs: [
          'O KÔMA não presume consentimento para cookies não essenciais de publicidade ou rastreamento comportamental. Se ferramentas dessa natureza forem ativadas, a interface e esta Política serão atualizadas conforme a base legal e os requisitos aplicáveis.',
          'Métricas estritamente técnicas de segurança e desempenho podem ser tratadas sem cookie publicitário quando houver fundamento legal apropriado.',
        ],
      },
      {
        title: '5. Terceiros e controle pelo usuário',
        paragraphs: [
          'Serviços externos carregados pelo navegador, como fontes e provedores integrados, podem receber metadados técnicos conforme suas próprias políticas.',
          'O usuário pode apagar dados locais e cookies nas configurações do navegador, mas a remoção de itens estritamente necessários pode encerrar a sessão, apagar preferências ou impedir a retomada de fluxos em andamento.',
        ],
      },
    ],
  },
  {
    slug: 'cardapio-termos',
    title: 'Termos de Uso do Cardápio Digital KÔMA',
    shortTitle: 'Termos do Cardápio',
    summary: 'Regras para consumidores que usam o cardápio digital e realizam pedidos ao restaurante.',
    audience: 'Consumidores dos restaurantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Quem vende o produto',
        paragraphs: [
          'O restaurante identificado no cardápio é o fornecedor dos alimentos, bebidas e demais produtos oferecidos ao consumidor. O KÔMA fornece a tecnologia utilizada para exibir a oferta, registrar o pedido e integrar etapas operacionais.',
          'Questões sobre ingrediente, preparo, qualidade, disponibilidade, entrega, troca e cumprimento da oferta devem ser resolvidas com o restaurante, sem prejuízo das responsabilidades legais que eventualmente caibam diretamente ao KÔMA por sua própria atuação.',
        ],
      },
      {
        title: '2. Oferta, preços e disponibilidade',
        paragraphs: [
          'Preços, descrições, horários, taxas, áreas de entrega, promoções e disponibilidade são definidos pelo restaurante. Antes de concluir, o consumidor deve revisar itens, quantidades, endereço, modalidade de atendimento e total exibido.',
          'Se houver divergência relevante antes do aceite do restaurante, o pedido pode ser rejeitado ou ajustado somente com transparência e concordância quando exigida.',
        ],
      },
      {
        title: '3. Pedido e confirmação',
        paragraphs: [
          'O envio do pedido registra uma solicitação ao estabelecimento. O fluxo pode exigir aceite do restaurante antes do início do preparo.',
          'O sistema utiliza identificadores e controles de idempotência para reduzir duplicidades, mas o consumidor deve evitar repetir a ação de pagamento ou envio quando houver resultado pendente sem antes verificar o status.',
        ],
      },
      {
        title: '4. Pagamentos online',
        paragraphs: [
          'Quando o pagamento online estiver disponível, ele é processado por provedor externo integrado. O provedor pode aplicar autenticação, antifraude e suas próprias condições.',
          'O KÔMA não armazena necessariamente os dados completos do meio de pagamento. Status de pagamento recebidos do provedor são usados para atualizar o pedido.',
        ],
      },
      {
        title: '5. Cancelamentos, reembolsos e chargebacks',
        paragraphs: [
          'Cancelamento e reembolso dependem do estágio do pedido, dos direitos previstos em lei, da política legítima do restaurante e das regras do provedor de pagamento.',
          'Quando houver split, a devolução financeira pode envolver parcelas do restaurante e da plataforma. Limitações técnicas do provedor não eliminam direitos legalmente assegurados ao consumidor.',
        ],
      },
      {
        title: '6. Entrega e retirada',
        paragraphs: [
          'Prazo exibido é estimativa operacional, salvo garantia expressa do restaurante. Trânsito, clima, demanda, endereço incorreto e outros fatores podem afetar a entrega.',
          'O consumidor deve fornecer endereço e contato corretos. O restaurante é responsável pela execução da entrega quando ela fizer parte da oferta.',
        ],
      },
      {
        title: '7. Alergias, intolerâncias e saúde',
        paragraphs: [
          'Em caso de alergia, intolerância ou restrição alimentar, o consumidor deve confirmar diretamente com o restaurante ingredientes, risco de contaminação cruzada e possibilidade de adaptação antes do consumo.',
          'O campo de observação pode ser usado para informar dado de saúde estritamente necessário à preparação segura. Não inclua informação sensível sem relação com o pedido.',
        ],
      },
      {
        title: '8. Produtos 18+',
        paragraphs: [
          'A conclusão online de produto sujeito a restrição etária somente deve ocorrer quando o fluxo disponibilizado atender aos requisitos legais de verificação aplicáveis. Simples declaração de idade não substitui mecanismo mais robusto quando a lei o exigir.',
          'O restaurante também pode exigir verificação no momento da entrega ou retirada e recusar o fornecimento quando os requisitos legais não forem atendidos.',
        ],
      },
      {
        title: '9. Uso adequado',
        bullets: [
          'Não realizar pedidos fraudulentos, ataques, testes abusivos ou tentativa de acessar dados de terceiros.',
          'Não explorar falhas de preço, autenticação ou pagamento de forma intencional.',
          'Não inserir conteúdo ilícito, ofensivo ou dados pessoais desnecessários nos campos livres.',
        ],
      },
      {
        title: '10. Suporte e lei aplicável',
        paragraphs: [
          'Para questões do pedido, o consumidor deve utilizar os canais do restaurante quando disponíveis. Problemas estritamente técnicos do cardápio podem ser encaminhados pelos canais indicados na aplicação.',
          'Aplicam-se as leis brasileiras e os direitos obrigatórios do consumidor. Estes Termos não restringem direitos que não possam ser afastados contratualmente.',
        ],
      },
    ],
  },
  {
    slug: 'cardapio-privacidade',
    title: 'Política de Privacidade do Cardápio Digital KÔMA',
    shortTitle: 'Privacidade do Cardápio',
    summary: 'Como dados de consumidores são tratados para pedidos, pagamentos, entrega, suporte e segurança.',
    audience: 'Consumidores dos restaurantes',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        title: '1. Controlador e Operador',
        paragraphs: [
          'Para os dados coletados para receber e executar seu pedido, o restaurante identificado no cardápio é, em regra, o Controlador e decide as finalidades comerciais. O KÔMA atua como Operador ao fornecer a plataforma e seguir as configurações e instruções legítimas do estabelecimento.',
          'O KÔMA pode atuar como Controlador independente em tratamentos estritamente próprios de segurança, prevenção a fraude, defesa de direitos e cumprimento de obrigação legal.',
        ],
      },
      {
        title: '2. Dados tratados no pedido',
        bullets: [
          'Nome e dados de contato informados pelo consumidor.',
          'Itens, quantidades, adicionais, observações, valores, horário e status do pedido.',
          'Endereço e referência quando necessários ao delivery.',
          'Forma de pagamento, identificadores e status da transação, sem exigir que o KÔMA armazene o número completo do cartão.',
          'Dados técnicos como IP, User-Agent, data, hora, identificadores de sessão e chave de idempotência quando necessários à segurança.',
        ],
      },
      {
        title: '3. Alergias e dados sensíveis',
        paragraphs: [
          'Se o consumidor informar alergia, intolerância ou outra condição de saúde em observação, essa informação é dado pessoal sensível e deve ser limitada ao necessário para preparação segura.',
          'O dado será disponibilizado às pessoas do restaurante que precisem conhecê-lo para executar o pedido e poderá ser mantido apenas pelo período necessário ou autorizado pela legislação. Evite inserir diagnóstico ou informação sensível sem relação com a compra.',
        ],
      },
      {
        title: '4. Finalidades',
        bullets: [
          'Registrar, confirmar, preparar, cobrar, entregar e acompanhar o pedido.',
          'Prevenir duplicidade, fraude e abuso.',
          'Prestar atendimento e resolver contestação, cancelamento ou reembolso.',
          'Cumprir obrigação legal e permitir exercício regular de direitos.',
          'Gerar histórico para o restaurante quando a funcionalidade contratada e a base legal aplicável permitirem.',
        ],
      },
      {
        title: '5. Pagamentos',
        paragraphs: [
          'Pagamentos online são processados por provedor integrado, que pode tratar dados como controlador independente para suas atividades reguladas. O KÔMA recebe os identificadores e estados necessários para reconciliar a transação com o pedido.',
          'Tarifas, autenticação, antifraude, chargeback e parte das retenções podem seguir as políticas do provedor.',
        ],
      },
      {
        title: '6. Entregas',
        paragraphs: [
          'Quando houver delivery, nome, telefone, endereço e informações necessárias podem ser disponibilizados ao restaurante e ao entregador encarregado, apenas na extensão necessária à entrega e ao suporte.',
          'O restaurante deve orientar sua equipe e entregadores a não reutilizar esses dados para finalidade incompatível.',
        ],
      },
      {
        title: '7. Compartilhamento e infraestrutura',
        paragraphs: [
          'Dados podem ser processados pela infraestrutura do KÔMA e por fornecedores indispensáveis de hospedagem, banco de dados, armazenamento, pagamentos e entrega de conteúdo. A relação pública de Suboperadores e Transferências descreve os principais serviços.',
          'A infraestrutura pode envolver tratamento internacional de dados, sujeito aos mecanismos e salvaguardas previstos na LGPD e na regulamentação da ANPD.',
        ],
      },
      {
        title: '8. Retenção',
        paragraphs: [
          'O prazo depende das finalidades do restaurante, obrigações legais, segurança, prevenção a fraude e exercício de direitos. O KÔMA não deve reter em nome do restaurante por tempo indefinido sem finalidade.',
          'Após o encerramento contratual do restaurante, aplica-se a política de exportação, eliminação, anonimização e retenções legalmente necessárias prevista no DPA.',
        ],
      },
      {
        title: '9. Direitos do titular',
        paragraphs: [
          'O consumidor pode exercer os direitos previstos na LGPD perante o restaurante Controlador. Quando a solicitação depender tecnicamente da plataforma, o KÔMA prestará a cooperação prevista no DPA.',
          'Solicitações diretamente recebidas pelo KÔMA podem ser encaminhadas ao restaurante quando ele for o responsável pela decisão sobre o tratamento.',
        ],
      },
      {
        title: '10. Segurança e contato',
        paragraphs: [
          'O KÔMA aplica medidas de segurança proporcionais ao risco, mas nenhum serviço conectado à internet é absolutamente imune a incidentes.',
          'Para questões sobre o uso comercial dos dados do pedido, o consumidor deve procurar o restaurante. Para questões estritamente relacionadas à plataforma ou para identificar o canal correto, pode utilizar os contatos oficiais indicados pelo KÔMA.',
        ],
      },
    ],
  },
];

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
