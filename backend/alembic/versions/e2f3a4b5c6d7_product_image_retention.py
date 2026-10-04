"""Durable product image retention and database-level concurrency fencing."""
from alembic import op
import sqlalchemy as sa

revision = 'e2f3a4b5c6d7'
down_revision = 'd1e2f3a4b5c6'
branch_labels = depends_on = None

# Keep this parser stricter than URL normalization. Encoded legacy URLs are
# protected by the conservative reference check and enrolled by reconciliation.
POSTGRES_SQL = r'''
CREATE OR REPLACE FUNCTION koma_internal.image_reference_text(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE result text := ''; position integer := 1; chunk text; code integer;
BEGIN
 WHILE position <= length(COALESCE(value, '')) LOOP
   chunk := substring(value FROM position FOR 3);
   IF chunk ~ '^%[0-9A-Fa-f]{2}$' THEN
     code := ('x' || substring(chunk FROM 2))::bit(8)::integer;
     -- Canonical filenames are ASCII; leave non-ASCII/NUL escapes opaque.
     IF code BETWEEN 1 AND 127 THEN
       result := result || chr(code); position := position + 3; CONTINUE;
     END IF;
   END IF;
   result := result || substring(value FROM position FOR 1); position := position + 1;
 END LOOP;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION koma_internal.product_image_path(value text, tenant integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT CASE WHEN candidate ~ ('^' || tenant || '/products/[A-Za-z0-9][A-Za-z0-9_.-]*$')
 THEN candidate ELSE NULL END FROM (
 SELECT regexp_replace(split_part(koma_internal.image_reference_text(value), '?', 1),
 '^(https?://[^/]+/storage/v1/object/public/)?(cardapio-assets/)?', '') AS candidate
 ) normalized
$$;

CREATE OR REPLACE FUNCTION koma_internal.product_image_referenced(tenant integer, path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off AS $$
DECLARE filename text;
BEGIN
 IF tenant <> COALESCE(NULLIF(current_setting('app.current_restaurante_id', true), ''), '0')::integer
    OR koma_internal.product_image_path(path, tenant) IS DISTINCT FROM path THEN
   RAISE EXCEPTION 'Invalid image lifecycle scope';
 END IF;
 filename := split_part(path, '/', 3);
 RETURN EXISTS (SELECT 1 FROM public.produtos p
   WHERE strpos(koma_internal.image_reference_text(p.imagem), filename) > 0
      OR strpos(koma_internal.image_reference_text(p.imagens_galeria::text), filename) > 0);
END $$;

CREATE OR REPLACE FUNCTION koma_internal.track_product_images()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off AS $$
DECLARE tenant integer; previous_urls jsonb := '[]'; next_urls jsonb := '[]';
        value text; path text; retirement_time timestamp;
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.imagem IS NOT DISTINCT FROM NEW.imagem
    AND OLD.imagens_galeria::jsonb IS NOT DISTINCT FROM NEW.imagens_galeria::jsonb
    AND OLD.restaurante_id = NEW.restaurante_id THEN RETURN NEW; END IF;
 tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.restaurante_id ELSE NEW.restaurante_id END;
 IF TG_OP = 'UPDATE' AND OLD.restaurante_id <> NEW.restaurante_id THEN
   RAISE EXCEPTION 'Product tenant is immutable';
 END IF;
 -- Only image writes share this lock. It also protects historical cross-tenant
 -- references; no globally scoped Storage deletion is ever issued.
 PERFORM pg_advisory_xact_lock(1263488321);
 IF TG_OP <> 'INSERT' THEN
   previous_urls := jsonb_build_array(COALESCE(OLD.imagem, '')) || COALESCE(OLD.imagens_galeria::jsonb, '[]');
 END IF;
 IF TG_OP <> 'DELETE' THEN
   next_urls := jsonb_build_array(COALESCE(NEW.imagem, '')) || COALESCE(NEW.imagens_galeria::jsonb, '[]');
 END IF;
 FOR value IN SELECT jsonb_array_elements_text(next_urls) LOOP
   -- Fence references to any object with durable deletion intent, even foreign
   -- tenant/encoded aliases. Conservative matches fail closed.
   IF EXISTS (SELECT 1 FROM public.product_image_retirements r
      WHERE r.state IN ('deleting', 'deleted')
      AND strpos(koma_internal.image_reference_text(value), split_part(r.object_path, '/', 3)) > 0) THEN
      RAISE EXCEPTION 'Image already retired; upload a new image';
   END IF;
 END LOOP;
 FOR value IN SELECT jsonb_array_elements_text(previous_urls) LOOP
   path := koma_internal.product_image_path(value, tenant);
   IF path IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(next_urls) n(value)
      WHERE koma_internal.product_image_path(n.value, tenant) = path) THEN
     retirement_time := timezone('utc', clock_timestamp());
     INSERT INTO public.product_image_retirements
       (restaurante_id, object_path, retired_at, eligible_after, state, reason, attempts)
     VALUES (tenant, path, retirement_time,
             retirement_time + interval '7 days', 'pending', 'replaced', 0)
     ON CONFLICT (restaurante_id, object_path) DO UPDATE
       SET retired_at = EXCLUDED.retired_at, eligible_after = EXCLUDED.eligible_after
       WHERE product_image_retirements.state = 'pending';
   END IF;
 END LOOP;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER product_image_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.produtos
FOR EACH ROW EXECUTE FUNCTION koma_internal.track_product_images();
REVOKE ALL ON FUNCTION koma_internal.image_reference_text(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION koma_internal.product_image_path(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION koma_internal.product_image_referenced(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION koma_internal.track_product_images() FROM PUBLIC;
'''


def upgrade():
    op.create_table('product_image_retirements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False),
        sa.Column('object_path', sa.String(), nullable=False),
        sa.Column('retired_at', sa.DateTime(), nullable=False),
        sa.Column('eligible_after', sa.DateTime(), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('reason', sa.String(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('last_result', sa.String()),
        sa.Column('deleted_at', sa.DateTime()),
        sa.UniqueConstraint('restaurante_id', 'object_path', name='uq_image_retirement_object'))
    op.create_index('ix_image_retirement_due', 'product_image_retirements', ['restaurante_id', 'state', 'eligible_after'])
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.execute('CREATE SCHEMA IF NOT EXISTS koma_internal')
    op.execute(POSTGRES_SQL)
    op.execute('ALTER TABLE public.product_image_retirements ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public.product_image_retirements FORCE ROW LEVEL SECURITY')
    # Owner must bypass RLS for the boolean cross-tenant reference/tombstone checks.
    # Existing architecture uses a migration owner distinct from koma_app.
    op.execute('''CREATE POLICY product_image_retirements_tenant ON public.product_image_retirements
       USING (restaurante_id = COALESCE(NULLIF(current_setting('app.current_restaurante_id', true), ''), '0')::integer)
       WITH CHECK (restaurante_id = COALESCE(NULLIF(current_setting('app.current_restaurante_id', true), ''), '0')::integer)''')
    op.execute('''DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
       GRANT SELECT, INSERT, UPDATE ON public.product_image_retirements TO koma_app;
       GRANT USAGE, SELECT ON SEQUENCE public.product_image_retirements_id_seq TO koma_app;
       GRANT EXECUTE ON FUNCTION koma_internal.product_image_referenced(integer, text) TO koma_app;
       END IF; END $$''')


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP TRIGGER IF EXISTS product_image_lifecycle ON public.produtos')
        op.execute('DROP FUNCTION IF EXISTS koma_internal.track_product_images()')
        op.execute('DROP FUNCTION IF EXISTS koma_internal.product_image_referenced(integer, text)')
        op.execute('DROP FUNCTION IF EXISTS koma_internal.product_image_path(text, integer)')
        op.execute('DROP FUNCTION IF EXISTS koma_internal.image_reference_text(text)')
    op.drop_table('product_image_retirements')
