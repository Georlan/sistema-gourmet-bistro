"""Add Super Admin tenant ID reuse eligibility inspection helper.

Revision ID: f0a1b2c3d4e5
Revises: ef947a23bc81
Create Date: 2026-11-03 20:35:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "ef947a23bc81"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Preserva registros existentes de backup sem apagá-los nem alterar dados:
    # apenas adiciona metadados opcionais caso a tabela histórica exista.
    op.execute(
        """
        DO $$
        BEGIN
            IF pg_catalog.to_regclass('koma_internal.transaction_reset_backups') IS NOT NULL THEN
                ALTER TABLE koma_internal.transaction_reset_backups
                    ADD COLUMN IF NOT EXISTS legacy_tenant_label text,
                    ADD COLUMN IF NOT EXISTS detached_from_active_id_at timestamptz;
            END IF;
        END;
        $$
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.inspect_tenant_id_blockers(
            p_candidate_id integer
        ) RETURNS TABLE (
            blocker_code text,
            source_name text,
            source_column text,
            row_count bigint,
            detail text
        )
        LANGUAGE plpgsql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
        DECLARE
            v_slug text;
            v_nome text;
            v_count bigint;
            v_backup_ids text;
            v_has_detached_col boolean;
            rec record;
        BEGIN
            IF NOT (
                pg_catalog.pg_has_role(session_user, 'koma_app', 'member')
                OR current_user IN ('postgres', 'supabase_admin')
            ) THEN
                RETURN;
            END IF;

            IF p_candidate_id IS NULL OR p_candidate_id < 1 THEN
                RETURN QUERY SELECT
                    'invalid_id'::text,
                    'input'::text,
                    'id'::text,
                    1::bigint,
                    'O ID do restaurante deve ser um inteiro positivo (>= 1).'::text;
                RETURN;
            END IF;

            IF pg_catalog.to_regclass('public.restaurantes') IS NOT NULL THEN
                SELECT r.slug::text, r.nome::text
                  INTO v_slug, v_nome
                  FROM public.restaurantes AS r
                 WHERE r.id = p_candidate_id
                 LIMIT 1;
                IF FOUND THEN
                    RETURN QUERY SELECT
                        'occupied'::text,
                        'public.restaurantes'::text,
                        'id'::text,
                        1::bigint,
                        pg_catalog.format(
                            'ID #%s está ocupado pelo restaurante %s (%s).',
                            p_candidate_id,
                            COALESCE(v_nome, 'sem nome'),
                            COALESCE(v_slug, 'sem slug')
                        )::text;
                    RETURN;
                END IF;
            END IF;

            FOR rec IN
                SELECT
                    c.table_name::text AS tbl_name,
                    c.column_name::text AS col_name
                  FROM information_schema.columns AS c
                  JOIN information_schema.tables AS t
                    ON t.table_schema = c.table_schema
                   AND t.table_name = c.table_name
                 WHERE c.table_schema = 'public'
                   AND t.table_type = 'BASE TABLE'
                   AND c.column_name IN ('restaurante_id', 'destino_restaurante_id')
                   AND c.data_type IN ('integer', 'bigint', 'smallint')
                   AND NOT (c.table_name = 'restaurantes' AND c.column_name = 'id')
                 ORDER BY c.table_name, c.column_name
            LOOP
                EXECUTE pg_catalog.format(
                    'SELECT count(*)::bigint FROM public.%I WHERE %I = $1',
                    rec.tbl_name,
                    rec.col_name
                ) INTO v_count USING p_candidate_id;

                IF COALESCE(v_count, 0) > 0 THEN
                    RETURN QUERY SELECT
                        CASE
                            WHEN rec.tbl_name = 'super_admin_audit_logs' THEN 'audit_log_residue'::text
                            ELSE 'public_table_residue'::text
                        END,
                        ('public.' || rec.tbl_name)::text,
                        rec.col_name::text,
                        v_count,
                        pg_catalog.format(
                            '%s registro(s) residual(is) em public.%s.%s para o ID #%s.',
                            v_count,
                            rec.tbl_name,
                            rec.col_name,
                            p_candidate_id
                        )::text;
                END IF;
            END LOOP;

            IF pg_catalog.to_regclass('public.super_admin_audit_logs') IS NOT NULL THEN
                SELECT count(*)::bigint
                  INTO v_count
                  FROM public.super_admin_audit_logs AS a
                 WHERE (a.restaurante_id IS NULL OR a.restaurante_id <> p_candidate_id)
                   AND (
                       COALESCE(a.before_data::jsonb->>'restaurante_id', '') = p_candidate_id::text
                       OR COALESCE(a.after_data::jsonb->>'restaurante_id', '') = p_candidate_id::text
                   );
                IF COALESCE(v_count, 0) > 0 THEN
                    RETURN QUERY SELECT
                        'audit_log_residue'::text,
                        'public.super_admin_audit_logs'::text,
                        'json_payload'::text,
                        v_count,
                        pg_catalog.format(
                            '%s registro(s) de auditoria referenciam o ID #%s em before_data/after_data.',
                            v_count,
                            p_candidate_id
                        )::text;
                END IF;
            END IF;

            IF pg_catalog.to_regclass('koma_internal.transaction_reset_backups') IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1
                      FROM information_schema.columns AS ic
                     WHERE ic.table_schema = 'koma_internal'
                       AND ic.table_name = 'transaction_reset_backups'
                       AND ic.column_name = 'detached_from_active_id_at'
                ) INTO v_has_detached_col;

                IF v_has_detached_col THEN
                    EXECUTE
                        'SELECT count(*)::bigint, string_agg(DISTINCT backup_id::text, '', '') '
                        'FROM koma_internal.transaction_reset_backups '
                        'WHERE restaurante_id = $1 AND detached_from_active_id_at IS NULL'
                    INTO v_count, v_backup_ids
                    USING p_candidate_id;
                ELSE
                    EXECUTE
                        'SELECT count(*)::bigint, string_agg(DISTINCT backup_id::text, '', '') '
                        'FROM koma_internal.transaction_reset_backups '
                        'WHERE restaurante_id = $1'
                    INTO v_count, v_backup_ids
                    USING p_candidate_id;
                END IF;

                IF COALESCE(v_count, 0) > 0 THEN
                    RETURN QUERY SELECT
                        'historical_backup_residue'::text,
                        'koma_internal.transaction_reset_backups'::text,
                        'restaurante_id'::text,
                        v_count,
                        pg_catalog.format(
                            '%s registro(s) de backup histórico em koma_internal.transaction_reset_backups (%s) vinculados ao ID #%s.',
                            v_count,
                            COALESCE(v_backup_ids, 'sem backup_id'),
                            p_candidate_id
                        )::text;
                END IF;
            END IF;

            IF pg_catalog.to_regclass('storage.objects') IS NOT NULL THEN
                EXECUTE
                    'SELECT count(*)::bigint FROM storage.objects '
                    'WHERE bucket_id = ''cardapio-assets'' AND name LIKE ($1::text || ''/%'')'
                INTO v_count
                USING p_candidate_id;

                IF COALESCE(v_count, 0) > 0 THEN
                    RETURN QUERY SELECT
                        'storage_prefix_residue'::text,
                        'storage.objects'::text,
                        'name'::text,
                        v_count,
                        pg_catalog.format(
                            '%s objeto(s) órfão(s) em storage.objects (bucket cardapio-assets) sob o prefixo %s/.',
                            v_count,
                            p_candidate_id
                        )::text;
                END IF;
            END IF;
        END;
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.inspect_tenant_id_blockers(integer) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.inspect_tenant_id_blockers(integer) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "DROP FUNCTION IF EXISTS koma_internal.inspect_tenant_id_blockers(integer)"
    )
