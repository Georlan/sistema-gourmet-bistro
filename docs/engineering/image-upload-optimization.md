# Upload automático de imagens

Novos uploads passam por `backend/app/services/image_optimization.py` antes de serem persistidos. Não há migração de arquivos existentes nesta entrega.

| Uso | Maior dimensão | Limite publicado |
| --- | --- | --- |
| Foto de produto | 1280 px | 200 KiB |
| Logo | 512 px | 100 KiB |
| Banner | 1920 px | 350 KiB |
| Foto para implantação assistida | 2560 px | 1 MiB |

O servidor valida o arquivo real, rejeita animações e imagens acima de 24 megapixels, aplica orientação da câmera, preserva proporção e transparência, remove metadados e publica WebP. Imagens menores não são ampliadas. WebP estático já dentro do orçamento, sem EXIF/ICC/XMP, mantém exatamente seus bytes depois de validado. Logos tentam compressão sem perdas primeiro; fotos complexas são reduzidas progressivamente dentro do limite de resolução previsto, ou recusadas com mensagem clara. Fontes do cardápio assistido usam qualidade maior para leitura dos textos; PDFs não são transformados.

Produtos, logos e banners também são preparados no navegador: seleção de até 20 MiB, redução antes do envio e payload máximo de 5 MiB. O limite de entrada do servidor continua 5 MiB para esses três endpoints e 10 MiB para implantação assistida. O navegador aceita até 48 megapixels para redução; o servidor continua sendo a autoridade final.

A codificação roda fora do event loop, com uma única imagem por processo e resposta 429 quando ocupada. A transação de leitura é liberada antes da codificação e do HTTP externo. Arquivos públicos usam nova URL UUID e cache longo, sem sobrescrever objetos. Substituir foto de produto mantém o objeto anterior; remoção explícita continua seguindo o fluxo existente. A retenção e a limpeza desses objetos devem ser tratadas separadamente, sem exclusão automática nesta entrega.

Validação local com três arquivos públicos, sem alterar produção: produto 2.947.814 → 180.594 bytes; logo 2.341.891 → 95.470; banner 2.464.418 → 283.570. Os resultados variam conforme a imagem. Isso reduz Storage e tráfego de imagens; não representa teste de capacidade de pedidos nem garantia de disponibilidade.
