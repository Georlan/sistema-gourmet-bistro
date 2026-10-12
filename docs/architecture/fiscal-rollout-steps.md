# Fiscal KÔMA — evolução por etapas

A preparação cadastral não comprova emissão autorizada. A interface deve guiar a
próxima ação usando estado persistido e evidências, sem usar pagamento recebido,
credencial armazenada ou preflight verde como selo de regularidade fiscal.

## Referência de experiência observada em 12/10/2026

Consulta somente leitura à sessão BeeFood autorizada pelo usuário:
- `/fiscal-configuracao`: resumo por estabelecimento, credenciais e documentos separados.
- `/nfce?prod=1`: venda/recebimento separado do estado da nota; consultas e XMLs.
- `/edicao-fiscal`: pendências de classificação com filtros por produto.

Capturas fornecidas complementam notas recebidas, fechamento e dados do contador.
Isso é referência de fluxo, não fonte normativa ou prova de correção tributária.
Não copiar classificações, números de série, certificados, CSC ou dados do cliente
observado para o KÔMA. Nenhuma configuração do BeeFood foi salva.

## Entrega atual — preparação simples

Resumo do restaurante e próximo passo; cadastro, certificado/CSC e conferência.
Credenciais já armazenadas ficam em resumo, com substituição explícita; senha e
CSC não retornam preenchidos. Certificado com validade conhecida vencida aparece
como pendência, sem alterar o backend. Diagnósticos técnicos ficam recolhidos.

Restaurantes que já emitem devem manter seu emissor funcional durante a preparação.
Migração exige conferir ambiente, série e continuidade da numeração; não oferecer
campo livre que sobrescreva a sequência fiscal já usada.

## Próxima entrega — tributação dos produtos

Usar ProductFiscalProfile e vigências existentes. Mostrar apenas pendências
aplicáveis ao regime/operação, com revisão do responsável fiscal e trilha de
aprovação. Produto sem CEST não é automaticamente um erro em qualquer situação.
Não inferir NCM, CFOP, CST/CSOSN ou alíquota pelo nome do prato.

## Emissão e pagamentos

Adapter fiscal, XML, assinatura e autorização; modelo apropriado por operação,
regime e jurisdição. Associar itens/valores e pagamentos sem lacunas ou duplicidade.
Consultar timeout/estado desconhecido antes de reenviar; contingência, eventos e
recuperação precisam estar executáveis. Habilitação depende de prova de homologação.

Fontes oficiais consultadas novamente:
- CONFAZ, Ajuste 19/16 consolidado:
  https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16
- CE, IN 87/2025 consolidada e alterações:
  https://sefazlegis.sefaz.ce.gov.br/api/openFile?id=fb3405db-006a-48dd-ba9d-a051c99b8d52

Aplicabilidade/exceções e vigência precisam ser registradas; a obrigação de vínculo
não é a mesma para qualquer meio de pagamento/operação. Preservar as pendências
normativas identificadas em fiscal-core.md e confirmar regras estaduais antes do piloto.

## Operação fiscal e contador

Separar venda, recebimento e documento autorizado. Incluir pendências operacionais,
consultas, cancelamentos e XML/protocolo. Fechamento contábil usa documentos fiscais
reais e eventos, não o total de pagamentos como substituto. Notas recebidas e importação
para estoque são entregas posteriores, independentes da emissão de vendas.

## Custos e liberação

Sem nova assinatura fiscal, API paga ou infraestrutura dedicada nesta entrega.
Validar alternativa de fonte aberto e custo medido na infraestrutura existente;
não prometer ausência de custo de certificado/manutenção/armazenamento.

Não desligar emissor existente para testar KÔMA, não repetir uma venda já documentada
e não importar secretamente credenciais do concorrente. Testar isoladamente antes
de piloto autorizado. PR/checks verdes não substituem autorização fiscal real.
