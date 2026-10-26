# Substituição do App do Entregador

Base verificada: origin/main 2fa52fa6, em 26/10/2026. Branch existente: design/courier-refinement-20261025. A versão anterior da main é substituída no mesmo src/components/MotoboyPwaPage.tsx. App.tsx mantém uma única importação lazy e o mesmo owner para a superfície entregador; aliases e links existentes continuam apontando para ele. Não há flag de segunda interface nem pacote de demonstração dentro do produto.

## Responsabilidades

A página coordena sessão e operações existentes. courier/ possui apresentação, assets, viagem, GPS pontual, cache cifrado, socket e shell offline. O read model backend permanece em courier_order_projection; transições continuam no Core de pedidos. A projeção substitui o cálculo antigo por pedido com lazy-load, telefone e fila de prontos/não atribuídos. Frontend não decide quitação e não chama marketplaces.

O bootstrap tolera bloqueio do armazenamento de sessão: usa o link em memória e limpa o segredo da URL após a inicialização, inclusive no StrictMode. Sem armazenamento, recarregar exige reabrir o link; nunca se amplia a persistência da credencial.

Não foram adicionadas dependências npm. Marcas dos canais têm origem registrada em src/assets/brand/delivery/. Arte própria, ícones e estilos são locais; sem chamadas remotas de imagens, mapas embutidos ou observação GPS permanente.

## Contratos preservados

- Rota /entregador e links legados; credencial removida da URL e enviada em header/subprotocolo dedicado.
- TTL de quatro horas, revogação e atribuição por tenant/entregador; o cache não prolonga autorização.
- Sem repetição automática de POST. Acesso offline somente à última lista autorizada; confirmação depende da rede e reconciliação.
- Código novo de três números, compatibilidade com quatro já emitidos. Pago não dispensa o recibo.
- Entrega concluída com saldo fica aberta para recebimento no Caixa; não cria pagamento. Conclusão de parceiro é somente interna.
- Worker apenas no escopo /entregador; cache de shell e assets estáticos, sem cache HTTP da API ou alteração do worker de push raiz.

## Validação e limites

A cobertura inclui UI mobile/desktop, teclado e clique fora, sessão por aba, troca de acesso, revogação, despacho, dados offline, F5 sem rede, reconexão, código e estado financeiro, WS e isolamento. Registrar os resultados finais no PR e na evidência da tarefa; logs antigos não validam o HEAD final.

Testes em dispositivo físico e integração com marketplaces não são comprovados por Chromium emulado ou logos. Não há homologação externa nem autorização excepcional própria para cliente pago sem código. A etapa dedicada Caixa–Entregador–Cardápio está descrita em docs/handoffs/courier-cashier-menu-integration-prompt.md.

## Migração e reversão

A migração f7b8c9d0e1f2 adiciona apenas campos opcionais/valores padrão de recibo; pedidos existentes não recebem novo código em massa. Backend e frontend devem ser publicados com o schema aplicado. Verificar head Alembic único e lineage em PostgreSQL isolado.

Reversão preferencial: reverter o PR sem remover as colunas aditivas, preservando recibos já emitidos. Downgrade remove os dados desses recibos e não é o rollback padrão de produção. Após autorização de merge/publicação, conferir SHA frontend/API e smoke com os SHAs esperados, depois prova operacional em ambiente autorizado. Não usar tenant 6 para testes sintéticos.
