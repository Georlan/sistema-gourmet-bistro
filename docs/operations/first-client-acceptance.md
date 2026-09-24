# Aceite operacional do primeiro cliente

Este é o gate de liberação do piloto pago. O piloto só está aceito quando todos
os blocos aplicáveis abaixo têm evidência anexada ao relatório. Para um Pocket
sem impressão contratada, registre o bloco 4 como `NÃO APLICÁVEL`, com plano e
escopo confirmados pelo restaurante, e valide a fila de preparo na tela durante
o turno completo. Se o restaurante depender de papel, o bloco 4 é obrigatório
e o Pocket não atende esse escopo.

Fila CUPS/Spooler criada,
teste automatizado ou status `printed` isoladamente não comprovam saída física
do papel.

Use o modelo em
[`first-client-acceptance-report-template.md`](./first-client-acceptance-report-template.md)
para registrar responsável, horário, identificadores de pedido e resultado.

## 1. Gate automatizado

Na revisão candidata a produção, execute:

```bash
npm run lint
npm run test:unit
npm run build
.venv/bin/python -m pytest print-agent/tests -q
bash scripts/regression_check.sh
npm run test:e2e
```

Critério: todos os comandos terminam com código zero. Salve os links dos checks
do pull request no relatório.

## 2. Tenant de homologação

Cadastre dados equivalentes à operação do cliente, sem usar dados fictícios em
produção:

- 1 administrador e 1 caixa; garçons somente se o recurso estiver contratado;
- mesas e setores iguais ao salão que será implantado, quando usados;
- categorias, produtos, adicionais e observações conferidos; fichas técnicas
  somente em plano com estoque;
- meios de pagamento que o restaurante realmente aceitar; taxa de serviço e
  bairros de entrega somente se usados;
- plano contratado e conexão Mercado Pago coerentes com a proposta assinada.
- processo fiscal atual do restaurante confirmado; não apresentar NFC-e pelo
  KÔMA como recurso disponível neste piloto.

Critério: duas pessoas conferem quantidades, preços, estoque inicial e acessos.

## 3. Turno completo

Execute no mesmo tenant e registre os IDs envolvidos:

1. abra o caixa com fundo de troco;
2. crie pedido em cada modalidade habilitada para o cliente: mesa, balcão,
   retirada e/ou delivery; inclua pedido pelo cardápio online quando usado;
3. acrescente e cancele um item com adicional e observação;
4. avance cozinha/bar até pronto e entregue;
5. solicite a conta, divida o pagamento e conclua a mesa;
6. faça sangria e suprimento;
7. feche o caixa em conferência cega;
8. compare pedidos, pagamentos e caixa; confira baixa de estoque somente se o
   recurso estiver contratado.

Critério: nenhuma diferença financeira ou, quando aplicável, de estoque;
nenhuma transação fica sem estado final.

## 4. Impressão física ponta a ponta

Obrigatório para planos e operações com impressão. Não execute este bloco como
critério do Pocket quando a operação foi contratada exclusivamente com fila de
preparo na tela; registre a justificativa no relatório.

Com a impressora conectada ao computador do restaurante, rode primeiro:

```bash
python3 print-agent/hardware_preflight.py \
  --report /tmp/koma-hardware-preflight.json
```

O comando deve retornar `status: PASSED`. `BLOCKED` impede o aceite, mesmo se
`lpstat` ou o Spooler disser que a fila está ociosa.

Depois, com o Print Agent pareado e ativo:

1. em **Configurações → Salão e impressão**, use **Imprimir teste**;
2. crie um pedido real de homologação com um item de COZINHA e outro de BAR,
   ambos com adicional e observação;
3. solicite uma conferência de conta;
4. confirme no monitor os três `PrintJob` e confira conteúdo, acentos, corte e
   destino no papel;
5. desligue a impressora, gere outro pedido e confirme que o job permanece
   pendente, sem ser perdido;
6. religue a impressora, aguarde a impressão única e confira a confirmação;
7. repita com falta de papel; depois reponha o papel e use reimpressão somente
   se o monitor indicar falha recuperável;
8. reinicie o computador e confirme que o Print Agent volta automaticamente.

Critério: zero job perdido, zero duplicidade automática, cozinha/bar separados
e confirmação visual assinada por quem acompanhou o papel. `printed` significa
que o sistema operacional aceitou o trabalho; por isso a conferência visual é
obrigatória.

## 5. Pagamento online e cobrança do plano

Confirme no contrato o ciclo e o valor fixo do Pocket: R$ 39 mensais ou
R$ 421,20 pelo ciclo anual com 10% de desconto no componente fixo. A taxa de
1,79% só se aplica aos pagamentos online elegíveis e não recebe desconto anual.
Registre a tela de revisão e o valor autorizado no provedor antes de concluir
a contratação; não trate uma simulação como cobrança real.

Se o restaurante habilitar Pix online, faça com ele uma transação controlada e
um estorno, com consentimento e valores combinados. Confira no provedor e no
KÔMA o valor bruto, a taxa KÔMA efetiva, o líquido do restaurante, o estado do
pedido e o retorno do estorno. Verifique explicitamente o estado da trava
`ONLINE_PAYMENT_PLAN_FEES_ENABLED` em produção. Se Pix online não fizer parte
da implantação, registre `NÃO APLICÁVEL` para a transação e não anuncie a
taxa como receita já validada.

Critério: valor fixo e ciclo coincidem com a proposta; nenhuma cobrança ou taxa
online é afirmada como validada sem comprovante do provedor.

## 6. Cenários hostis

- repita a mesma requisição e verifique idempotência;
- tente vender produto sem estoque somente se esse controle estiver contratado;
- tente operar com caixa fechado;
- expire a sessão no meio de uma venda;
- recarregue a tela antes e depois da confirmação de uma operação;
- desconecte e reconecte a rede com pedidos pendentes; inclua jobs de impressão
  quando esse recurso fizer parte da operação.

Critério: mensagem acionável ao operador, sem pedido duplicado ou valor
alterado; sem estoque corrompido ou job perdido nos recursos aplicáveis.

## Decisão

- **APROVADO:** todos os critérios aplicáveis passaram e têm evidência; qualquer
  `NÃO APLICÁVEL` tem escopo e justificativa registrados.
- **BLOQUEADO:** existe dependência física/externa não disponível.
- **REPROVADO:** houve erro reproduzível; abra correção e repita todo o bloco
  afetado após o merge.

Nunca converta `BLOQUEADO` em `APROVADO` por suposição.
