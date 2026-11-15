# Login da equipe e sessões por aba

Base desta refatoração: main `8cb17110045f` (26/10/2026). O owner de entrada continua sendo `UnifiedOperationalEntry`; não há segunda biblioteca de login. Clientes do Cardápio, Super Admin e SmartPOS preservam seus owners próprios.

## Contrato

- Uma identidade operacional por aba. Caixa e Garçom, inclusive dois Caixas de restaurantes diferentes, podem coexistir no mesmo navegador.
- A aba autenticada mantém sua sessão ao recarregar. Outra aba, inclusive uma cópia do armazenamento da primeira, exige seu próprio login.
- Antes de montar a aplicação, `tabSessionOwnership` reserva um identificador aleatório com Web Locks (`ifAvailable`). Se ele já estiver ocupado, somente as credenciais copiadas da nova aba são descartadas e ela recebe outro identificador. Não há polling, banco, chave compartilhada de autenticação ou logout por BroadcastChannel.
- O identificador de aba não é uma credencial. Assinatura, status, escopo de tenant, permissões e revogação continuam sendo validados no backend.
- A proteção depende de contexto seguro e Web Locks, disponível nos navegadores modernos suportados. Sem esse recurso, a restauração de credenciais copiadas falha de forma segura e exige novo login; não se promete persistência entre recargas nesse navegador. Armazenamento bloqueado apresenta erro de sessão, sem copiar tokens para localStorage.
- Um link explícito do entregador continua sendo um acesso intencional, inclusive em nova aba. O segredo é consumido do fragmento pelo fluxo existente e removido da URL.

Referências da plataforma: [cópia de sessionStorage pelo opener](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) e [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).

## Identidade e persistência

`staffDestination` centraliza os destinos e a validação da resposta de login. Os papéis Caixa/Gestão/Cozinha/Atendente abrem sua experiência existente; Garçom abre o salão; Motoboy abre Entregador. Papéis desconhecidos não recebem um portal por fallback.

`authSession` mantém o registro mínimo e os aliases locais que os consumidores atuais ainda usam. Esses aliases são compatibilidade de leitura, não uma segunda fonte compartilhada de autenticação. Consultar uma sessão válida não regrava seu JSON. A validade real do JWT prevalece; leituras e retorno à aba não renovam seu prazo.

`useOperatorSessionToken` assina notificações apenas da janela atual. Login/logout avisam imediatamente; foco, pageshow e retorno de visibilidade revalidam a sessão. Um timeout é agendado para a expiração, sem o antigo intervalo de 250 ms. Respostas antigas de outra credencial continuam sujeitas aos guards de escopo existentes do App.

A identificação de analytics nas superfícies operacionais fica em memória por documento (`disable_persistence`), para login/reset de uma aba não alterar a identidade de outra por cookie. O comportamento público do Cardápio não foi alterado.

## Atalho/PWA operacional instalado (15/11/2026)

- Somente no PWA instalado de `app.komafood.com.br` (desktop/mobile), o login operacional mantém uma cópia cifrada da sessão no IndexedDB. Abas comuns continuam usando apenas `sessionStorage` e preservam o isolamento entre restaurantes.
- A chave AES-GCM de 256 bits é não exportável (Web Crypto) e armazenada no próprio IndexedDB; o JWT não vai para `localStorage` nem para a URL. Esta proteção não substitui defesa contra XSS ou proteção física do dispositivo desbloqueado.
- Ao reabrir o atalho sem sessão da janela, o bootstrap recupera a credencial somente se `sub`, `restaurante_id` e `exp` do JWT corresponderem à identidade cifrada e o prazo ainda não tiver vencido. As permissões, o status e a revogação continuam sendo conferidos nas requisições pelo backend.
- Salvar login e trocar de loja atualizam o snapshot persistente; logout/suspensão apagam a cópia. Sessões de suporte e tokens do entregador não entram nesse armazenamento. Sem IndexedDB/Web Crypto, o login continua funcional mas não persiste após fechar o PWA.
- O prazo permanece o configurado no backend (padrão atual de 30 dias), sem renovação automática nem necessidade de schema, cookie cross-site ou endpoint novo. Um JWT expirado/revogado pede novo login.

## Entregador

Após `/auth/login`, o JWT da equipe é usado apenas na troca `POST /comandas/motoboys/me/acesso`. O servidor seleciona o Motoboy ativo vinculado ao usuário autenticado no tenant atual e exige o entitlement existente. O cliente não escolhe tenant nem entregador por parâmetros.

O app retém somente o token restrito já usado pelo painel/WebSocket. A troca reutiliza um acesso ativo e seu prazo original de quatro horas; não gira o acesso de outros dispositivos. Geração/revogação manual pelo Caixa preserva o comportamento anterior. O prazo informado na primeira emissão e na reutilização vem do mesmo registro persistido.

“Sair das entregas” limpa o acesso desta aba e retorna ao login. Não é uma revogação administrativa global; a ação fica indisponível enquanto uma confirmação está em andamento ou precisa de reconciliação.

## Rede e verificação

A entrada cancela solicitações ao desmontar e impede envio duplicado. `authFetchJson` mantém o limite de tempo até terminar o corpo JSON, evitando autenticação pendurada após os headers. O contrato `authFetch` para consumidores de Response foi preservado.

Regressões cobrem contas/tenants em abas paralelas, cópia com/sem opener, recarga, logout real da UI, expiração, sessão substituída e respostas 401 antigas, armazenamento indisponível, papéis, seleção de estabelecimento, troca de loja, código e acesso do entregador. Testes backend verificam vínculo/atividade, plano, ausência de escalada e reutilização do prazo. Os resultados finais pertencem ao PR e à evidência do HEAD validado.

Não há migration, SDK, serviço ou dependência nova. Não foram usados pedidos, pagamentos ou configurações reais do tenant 6. Reversão é por código, mantendo válidos os links de entregador já emitidos.
