# Aceite operacional do primeiro cliente

Este é o gate de liberação do piloto pago. O piloto só está aceito quando todos
os blocos abaixo têm evidência anexada ao relatório. Fila CUPS/Spooler criada,
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

- 1 administrador, 1 caixa e ao menos 2 garçons;
- mesas e setores iguais ao salão que será implantado;
- categorias, produtos, adicionais, observações e fichas técnicas conferidos;
- dinheiro, Pix, débito e crédito; taxa de serviço e bairros de entrega;
- plano contratado e conexão Mercado Pago coerentes com a proposta assinada.

Critério: duas pessoas conferem quantidades, preços, estoque inicial e acessos.

## 3. Turno completo

Execute no mesmo tenant e registre os IDs envolvidos:

1. abra o caixa com fundo de troco;
2. crie pedido de mesa, balcão, retirada e delivery online;
3. acrescente e cancele um item com adicional e observação;
4. avance cozinha/bar até pronto e entregue;
5. solicite a conta, divida o pagamento e conclua a mesa;
6. faça sangria e suprimento;
7. feche o caixa em conferência cega;
8. compare pedidos, pagamentos, caixa e baixa de estoque.

Critério: nenhuma diferença financeira ou de estoque e nenhuma transação fica
sem estado final.

## 4. Impressão física ponta a ponta

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

## 5. Cenários hostis

- repita a mesma requisição e verifique idempotência;
- tente vender produto sem estoque;
- tente operar com caixa fechado;
- expire a sessão no meio de uma venda;
- recarregue a tela antes e depois da confirmação de uma operação;
- desconecte e reconecte a rede com jobs de impressão pendentes.

Critério: mensagem acionável ao operador, sem pedido duplicado, valor alterado,
estoque corrompido ou job perdido.

## Decisão

- **APROVADO:** todos os critérios passaram e têm evidência.
- **BLOQUEADO:** existe dependência física/externa não disponível.
- **REPROVADO:** houve erro reproduzível; abra correção e repita todo o bloco
  afetado após o merge.

Nunca converta `BLOQUEADO` em `APROVADO` por suposição.
