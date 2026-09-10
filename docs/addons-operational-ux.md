# Complementos: regra operacional

A operação segue a mesma memória muscular no Garçom e no Caixa:

- **+ Adicionar** lança rapidamente uma unidade limpa, sem abrir modal.
- **Clique no card** abre a personalização do produto.
- **Editar item** reabre a personalização antes do lançamento.

Grupos opcionais (`tipo=opcional`, `min_selecoes=0`) formam o catálogo geral de adicionais do restaurante. Vínculos por produto/categoria servem para ordenar e marcar recomendações; não impedem pedidos fora do padrão. Assim, uma baguete ou pastel pode receber bacon, hambúrguer, pão ou outro adicional opcional do mesmo tenant.

Grupos obrigatórios continuam restritos aos produtos/categorias em que foram vinculados. Isso evita transformar uma regra específica (por exemplo, ponto da carne) em exigência global.

O backend continua como fonte de verdade: os mesmos IDs de opções são validados e precificados pelo Core de Pedidos, independentemente do canal.