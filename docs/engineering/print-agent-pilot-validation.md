# Atualização do conector e validação na Bagueteria Pôr do Sol

## O que muda nesta versão

O servidor continua sendo o único responsável por montar o conteúdo térmico.
O conector local recebe esse conteúdo e o envia para a fila da impressora.
Alterar o layout no servidor pode surtir efeito sem atualizar o conector;
alterar o transporte local exige instalar a nova versão no computador.
Não existe atualização automática do código Python pelo GitHub nesta versão.

A versão `2026.09.05.1` separa a coleta de pedidos, os diagnósticos/heartbeat
e as confirmações HTTP em três sessões de rede. A busca seguinte não espera
essas confirmações. Um diagnóstico de impressora pronta vale por até 30 segundos;
após esse limite, a coleta aguarda uma nova verificação. A primeira verificação
no início do processo continua obrigatória. Falha de envio continua interrompendo
a fila física afetada. As filas mantêm a ordem por impressora.

O diário SQLite registra a aceitação pelo spooler antes da confirmação na nuvem.
Uma confirmação que falhou pode ser repetida sem enviar novamente o mesmo trabalho
registrado. Isso não comprova a saída física do papel: se o computador cair entre
o envio e a gravação no diário, o resultado é incerto. Conferir antes de reimprimir.

## Instalação sem copiar comandos

1. Fora do atendimento, espere as comandas pendentes terminarem. Feche o agente
   antigo caso exista uma janela manual do PowerShell executando o Kôma.
   Não encerre o conector do Anota AI.
2. Extraia o pacote completo e dê dois cliques em `INSTALAR-KOMA-WINDOWS.cmd`.
   O instalador já existe no projeto e foi reforçado nesta versão. Ele interrompe
   a tarefa agendada anterior, preserva os arquivos locais de configuração e
   diário da instalação, instala as dependências e inicia a tarefa atualizada.
3. Se solicitado, entre no Kôma e autorize o computador para o restaurante certo.
   Depois selecione a G250 no painel de impressão. Não copie tokens.
4. Confira que o agente aparece conectado e faça uma impressão de teste.
   Ele inicia automaticamente no próximo login do Windows; o usuário precisa
   estar conectado. Não é um serviço disponível antes do login.

Se o agente antigo foi executado em outra pasta, preserve seu `journal.db` e
`config.json`. A migração dessas pastas não é automática: conclua as pendências
antes de trocar e não apague o diário. O bloqueio contra processos duplicados
vale para esta versão e posteriores, no mesmo usuário do Windows; uma cópia
antiga ainda aberta precisa ser fechada.

O instalador não altera a impressora padrão do Windows. Não altera o Anota AI.
USB ainda exige um componente local; após essa instalação inicial, a escolha da
impressora e o pareamento ficam no Kôma. Instalador assinado e atualização automática
com retorno à versão anterior são melhorias posteriores, não recursos já entregues.

## Como medir sem confundir rede e impressora

Na amostra anterior à atualização, de 49 trabalhos confirmados em sete dias:
mediana de espera na nuvem 1,02 s; p95 4,03 s. Dois trabalhos tiveram mais de
30 s de espera, com máximo de aproximadamente 5,8 horas. A causa desses dois
casos não foi determinada. Reserva até confirmação: p95 0,98 s.
Esses números não medem a saída física do papel.

Para validar na G250/USB001 do restaurante 1:

- Faça pelo menos 20 lançamentos identificados como teste, incluindo adições à
  mesma mesa e pedidos de retirada. Confira conteúdo e ausência de duplicidade.
- Meça do clique de confirmação até o início da saída do papel. Registre o
  primeiro pedido após o agente abrir separadamente dos pedidos seguintes.
- Compare com o Anota AI no mesmo computador, sem imprimir simultaneamente.
- Reinicie o conector sem apagar o diário e confira que não repete comandas.
- Desconecte/reconecte a rede apenas fora do atendimento e verifique recuperação
  das pendências. Confira no Kôma antes de solicitar qualquer segunda via.

Alvo de aceitação do piloto: p95 de até 2 segundos do clique ao início do papel
com conexão estável, sem perda nem duplicidade nos testes. É um alvo a medir,
não um resultado já observado. Se a fila do Windows aceita rápido e o papel
demora, investigar driver, configuração da G250 e USB separadamente.

Os registros ficam na pasta de credenciais do usuário, arquivo `agent.log`,
com rotação em três cópias de até 2 MB. Eles discriminam espera na nuvem, reserva
HTTP e envio ao spooler. O agente também informa sua versão no heartbeat quando
o servidor suporta esse campo. Não enviar arquivos de credenciais em suporte.
