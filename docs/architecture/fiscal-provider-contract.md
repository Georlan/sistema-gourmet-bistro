# Fiscal Core — conexão independente do fornecedor

## Objetivo

Uma API própria/SEFAZ direta e um fornecedor terceirizado devem implementar o
mesmo contrato. O KÔMA permanece responsável pela identidade da venda, itens,
pagamentos, documento, sequência, snapshot de cálculo e estado persistido.

`backend/app/fiscal/providers.py` define contextos, requisições e respostas
imutáveis, capabilities e registro server-side. Não existe adapter real instalado
nesta entrega, nem comunicação externa ou endpoint para cadastrar URLs arbitrárias.

## Contrato de conexão

- Contexto: restaurante, ambiente e modelo explícitos; homologação de um restaurante
  não libera outro nem libera produção automaticamente.
- Requisição: ID persistido do documento, chave idempotente da operação, série/número,
  venda/cálculo congelados e versão tributária. `fingerprint` canônico detecta mudança
  de contexto, valores, numeração e versão; não inclui estado para preservar identidade
  durante consulta/conciliação. Segredos não pertencem ao envelope nem ao repr.
- `request_from_document` usa o documento persistido e valida tenant, estado, numeração
  e presença de cálculo/versionamento. Não recalcula usando cadastro atual e não aceita
  totais da resposta do provedor como substituto da venda.
- Adapter: readiness local com configuração e evidência de homologação específica;
  enviar, consultar, cancelar e inutilizar. Transportes, autenticação de conexão e
  tradução para o fornecedor pertencem ao adapter.
- Autorização: chave, protocolo e referência de XML autorizado; recibo de processamento
  do fornecedor não basta. Cancelamento exige protocolo do evento. Presença desses
  campos não verifica autenticidade: o adapter precisa validar a resposta fiscal,
  ambiente, chave, XML/schema/assinatura e armazenar o artefato correto.
- Falha de transporte vira `unknown` e nunca rejeição fiscal automática. `query` não
  repete `submit`; contexto/documento/operação divergentes são recusados.
- Gateway recusa ressubmeter documentos unknown/submitting/reconciling/finalizados.
  Preparar o envelope antes da transição durável ready → submitting; em recuperação
  de processo, consultar primeiro. O adapter precisa garantir a idempotência externa.

## Liberação atual

Preflight de fundação continua preparando cadastro. Ativação/emissão passam a exigir
adapter configurado/homologado e capabilities completas, além dos gates existentes.
Nenhum provedor é registrado por padrão: `direct_sefaz` no cadastro é apenas um nome,
não uma integração operacional. Falha de leitura da readiness permanece bloqueada.
O payload adiciona `providerReady` sem remover campos anteriores.

O registro é código do servidor, nunca opção arbitrária aceita do navegador. Ao
implementar um adapter, adicionar persistência segura de sua configuração por tenant
 e ambiente, seguindo o cofre existente. A chamada de readiness não deve usar rede
no caminho crítico da venda. Credenciais devem ficar em armazenamento cifrado/refs,
com política explícita de custódia e rotação; não importar CSC de outro sistema.

## O que ainda precisa estar concluído antes de conectar restaurantes

1. Snapshot real completo dos itens e de todos os pagamentos, impostos/classificação
   aprovados por responsável fiscal, descontos, taxas, combos e critérios de emissão.
2. Compatibilidade dos gates de cálculo/referências com regime e vigência; suporte
   persistido a NF-e 55 quando exigido. O contrato prevê 55/65; banco/runtime atuais
   continuam limitados ao modelo 65, sem migration nesta entrega.
3. Adapter real, XML/assinatura quando em custódia do KÔMA, validação da autorização,
   armazenamento/exportação, cancelamento e inutilização implementados.
4. Worker transacional/outbox, reconciliação e contingência executáveis; bind do
   documento/pagamentos, DANFE e testes completos de falha e duplicação.
5. Homologação por operação/regime e piloto autorizado; continuidade de série/numeração
   na migração. Manter o emissor vigente do restaurante durante a preparação.

A meta é o restaurante conectar uma integração já homologada com os dados prontos.
Este contrato é uma entrega dessa preparação, não prova de que todas as etapas acima
já existem. Não contratar serviço fiscal nem infraestrutura dedicada nesta etapa.
