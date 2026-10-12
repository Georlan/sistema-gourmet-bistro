# Fiscal: isolamento e repetição segura

Preparação de 12/10/2026; não habilita emissão nem conecta fornecedor. Preservar
fluxos atuais de pedidos, pagamentos, impressão e tenant 6.

## Garantias desta alteração

- `FiscalDocument` confere `(restaurante_id, comanda_id)`; `FiscalPayment`
  confere `(restaurante_id, pagamento_id)`. RLS protege a linha, enquanto a FK
  composta protege a identidade do vínculo, inclusive em SQL direto.
- Os pais operacionais ganham somente uniques redundantes `(restaurante_id,
  id)`, necessários às FKs. Nenhuma rotina operacional é alterada.
- Documento repetido só retorna replay quando ambiente, modelo, série,
  provedor, comanda, total normalizado e snapshot JSON canônico coincidem.
  Divergência gera `FiscalIdempotencyConflict`, inclusive após disputa de
  unicidade e rollback da numeração. JSON não finito/inválido é recusado antes
  da reserva. A comanda é conferida pelo tenant no serviço, além da FK.
- Evento repetido compara tipo, destino, protocolo externo e payload. O ator
  continua sendo metadado da primeira aplicação, não identidade do efeito.
  Depois de obter o lock, consultar a chave outra vez e atualizar a identidade
  carregada antes de validar estado. O perfil travado também é atualizado.
- Reavaliação prévia à criação preserva `fiscalPreflight.evaluatedAt` do
  documento original. Todo o restante da linhagem continua comparado. Uma
  mudança de referências não autoriza criar outra nota: reconciliar o documento
  existente e reaproveitar seu snapshot congelado no futuro dispatcher.
- A1 e CSC usam envelopes cifrados com tenant, CNPJ, país, UF, modelo e ambiente;
  CSC inclui seu ID. Carregamento recusa material de outro contexto, referência
  de outro tenant ou payload antigo sem contexto. Cifragem indisponível ou
  plaintext são recusados antes de consultar/persistir o segredo.
- Mudar emissor/ambiente/jurisdição invalida referências e metadados no perfil;
  edições normais de nome/endereço/série preservam material e continuam exigindo
  reativação. Reprs não contêm certificado, senha ou CSC.
- No frontend, API/credencial diferente desmonta a árvore fiscal e limpa
  rascunhos/segredos; callbacks da árvore antiga não atualizam a nova. Headers
  equivalentes preservam o rascunho. Requests já enviados não são cancelados:
  mantêm a credencial original. Troca normal de loja já recarrega a aplicação;
  esta defesa cobre mudança de sessão dentro do mesmo mount.

## Migration e reversão

Pré-publicação de 12/10/2026, somente leitura: banco na revisão anterior
`7b8c9d0e1f23`, nenhum documento/pagamento/perfil fiscal e nenhum vínculo
inválido. `comandas` e `pagamentos` têm menos de 1 MB cada, incluindo índices,
e não havia transação longa no momento da inspeção. O catálogo protegido do
tenant 6 tinha 18 produtos; comparar seu digest após a publicação. O deploy
Railway aplica `alembic upgrade head` em pre-deploy antes de trocar a aplicação.
Os limites de lock continuam valendo; falha de pre-deploy não autoriza reparar
ou reatribuir dados manualmente. Nenhuma credencial fiscal legada estava em uso.

Publicar em uma única PR a composição das entregas #1093, #1094, #1095 e #1097,
preservando tanto a invalidação de credenciais quanto o provedor salvo no perfil.
Revisão independente não encontrou bloqueadores para esta etapa com emissão
desabilitada. Registrar SHA e comprovação de migration/versões servidas após merge.

`1370ca2f0151` descende de `7b8c9d0e1f23`, sem branch Alembic paralela.
Upgrade aborta se encontrar vínculo fiscal ausente/cross-tenant; não reassocia
nem reescreve dados históricos. PostgreSQL valida as constraints e limita espera
por locks a 5 s e cada instrução a 60 s. SQLite tem fallback para testes.

Criar os dois índices únicos pode bloquear escrita nas tabelas operacionais.
Antes de publicar, revisar tamanho/duração e janela operacional; os limites não
substituem esse planejamento. Nenhuma migration foi aplicada em produção nesta
entrega. Downgrade remove somente FKs/uniques novas; não modifica linhas.

Reversão de aplicação deve considerar o formato novo do vault. A versão antiga
interpreta CSC como texto puro após decifrar; não alternar emissor em produção
com formatos incompatíveis. Como ainda não há emissor conectado, manter emissão
desabilitada e reprovisionar material fiscal na versão final escolhida. Payloads
legados precisam de reenvio seguro, sem backfill ou exposição de segredos.

## Validação

- Regressões locais de documento/evento, comanda errada, JSON, ambiente, valor,
  provedor e linhagem; disputa real em PostgreSQL garante documento único e
  recuperação sem consumir número adicional.
- PostgreSQL 17 efêmero: FKs sob RLS com role sem superuser/BYPASSRLS, scope
  ausente recusado, upgrade/downgrade e seis disputas/identidades antigas.
- Lineage completo desde banco vazio: 149 upgrades, head único, constraints
  validadas, RLS preservado e roundtrip da nova migration. Banco de lineage
  removido após teste; nenhum serviço temporário na nuvem.
- Browser: 12 casos desktop/mobile com A1/CSC/arquivo/rascunho, bootstrap e
  preflight atrasados, nova API, headers equivalentes e falha sem fallback.
  Nenhuma escrita HTTP nem dado real de restaurante nos cenários.
- Composição local das PRs #1093/#1094/#1095/#1097: 168 testes fiscais, 28
  cenários browser desktop/mobile, lint, 1.001 unitários frontend e build passaram.
  Os testes de sessão também passam na tela anterior, sem exigir a UI guiada.
- CI do backend desta alteração: 2.397 passaram e 69 skipped. A execução completa
  local anterior foi invalidada por processos pytest sobrepostos que removiam o
  mesmo SQLite da conftest; as oito simulações afetadas passaram em cópia isolada.
  Não usar esse resultado local contaminado como prova de falha operacional.
- `Merge verdict` passa a executar 22 regressões de FKs/RLS e concorrência
  em PostgreSQL local temporário para mudanças fiscais e fronteiras compartilhadas.
  O step falha com skips e remove o container no encerramento.

## Limites e próximos gates

O fiscal existente ainda é BR/CE/modelo 65; não anunciar emissão nacional ou
internacional. `ProductFiscalProfile` e modelos de linhas/pagamentos são
fundação, não editor aprovado, materializador nem motor tributário completo.

1. Retrato canônico da operação: descrições/composição, preço vendido,
   adicionais já incluídos, taxas, descontos, identidade fiscal validada e
   `PagamentoAlocacao`. Não usar `Pagamento.cpf_cliente` como CPF: o legado
   também o utiliza como telefone.
2. Classificação vigente aprovada e proteção de revisões/documentos/eventos.
   Snapshot e histórico não têm proteção append-only completa no banco hoje.
   `MAX(revision)` na projeção não pode ser resolvedor de emissão.
3. Estabelecimento emissor/connection: dois tenants com mesmo CNPJ, ambiente,
   modelo e série colidem se reservarem números independentemente. Definir
   dono/serie dedicada com validação antes de ativar; não impor unique global
   de CNPJ sem modelar múltiplos cardápios/filiais.
4. Vault versionado e segregação por connection quando houver múltiplos modelos,
   ambientes e países simultâneos. O vault atual mantém um A1/CSC por tenant;
   o envelope protege contexto, mas não cria histórico de rotação. Readiness
   atual lê metadados; adapter deve carregar/verificar material antes de enviar.
   Titularidade do certificado, cadeia ICP e credenciamento ainda exigem gate.
5. Dispatcher fiscal próprio: tentativas duráveis, timeout desconhecido,
   reconciliação, eventos autenticados e cobertura única dos itens. Não ligar
   emissão ao webhook genérico, que pode repetir efeitos ou marcar entrega sem
   consumidor configurado.
6. XML/protocolo/eventos privados por tenant, retenção e exportação, DANFE e
   contingência válidos. Reimprimir não reemitir; estornar pagamento não cancela
   documento automaticamente.
7. Contrato comercial com país/moeda/precisão/fuso/unidades; política fiscal por
   jurisdição/regime/vigência e capabilities homologadas. Provider selecionável,
   sem fallback de país/UF ou regra CE em jurisdição sem suporte.

Economia: cadastro de produto não chama API paga; compartilhar infraestrutura,
referências oficiais públicas versionadas e trabalho devido. Custos/franquias
de fornecedor pertencem à conta contratada e devem ser atribuídos aos tenants,
sem confundir 500 eventos por conta com 500 notas por restaurante.
