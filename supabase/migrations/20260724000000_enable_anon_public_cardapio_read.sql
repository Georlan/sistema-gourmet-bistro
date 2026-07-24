-- Migration: enable_anon_public_cardapio_read
-- Concede permissão SELECT para a role anon e adiciona políticas de leitura pública
-- para o Cardápio Digital em restaurantes, categorias e produtos (apenas itens ativos).
-- As políticas de tenant_isolation existentes para a aplicação/PDV permanecem intactas.

-- 1. Conceder permissão de SELECT para a role anon (PostgREST / cliente do Cardápio Digital)
GRANT SELECT ON public.restaurantes TO anon;
GRANT SELECT ON public.categorias TO anon;
GRANT SELECT ON public.produtos TO anon;

-- 2. Garantir política de leitura pública em restaurantes
DROP POLICY IF EXISTS leitura_publica_cardapio ON public.restaurantes;
CREATE POLICY leitura_publica_cardapio ON public.restaurantes
    FOR SELECT
    TO anon
    USING (true);

-- 3. Criar política de leitura pública em categorias
DROP POLICY IF EXISTS leitura_publica_categorias ON public.categorias;
CREATE POLICY leitura_publica_categorias ON public.categorias
    FOR SELECT
    TO anon
    USING (true);

-- 4. Criar política de leitura pública em produtos (apenas produtos ativos)
DROP POLICY IF EXISTS leitura_publica_produtos ON public.produtos;
CREATE POLICY leitura_publica_produtos ON public.produtos
    FOR SELECT
    TO anon
    USING (ativo = true);
