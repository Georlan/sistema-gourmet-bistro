import hashlib
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('migration_safety', Path(__file__).resolve().parents[2] / 'scripts/check_migration_safety.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def test_additive_nullable_column_and_destructive_downgrade_are_allowed():
    assert gate.hazards('''
def upgrade():
    op.add_column('orders', sa.Column('note', sa.String(), nullable=True))
def downgrade():
    op.drop_column('orders', 'note')
''') == []


def test_comments_do_not_trigger_but_helpers_aliases_and_dynamic_sql_do():
    assert gate.hazards('# op.drop_table("x")') == []
    assert gate.hazards('''
def helper():
    batch.drop_column('note')
def upgrade():
    helper()
    connection.execute(dynamic_sql)
''') == ['SQL/data operation requires compatibility and workload review', 'destructive operation: drop_column']


def test_nonnullable_python_default_is_not_a_server_default():
    assert gate.hazards("op.add_column('t', sa.Column('x', sa.Integer, nullable=False, default=0))")
    assert not gate.hazards("op.add_column('t', sa.Column('x', sa.Integer, nullable=False, server_default='0'))")
    assert gate.hazards("op.alter_column('t', 'x', new_column_name='y')")


def test_exception_is_bound_to_exact_content_and_review_evidence():
    source = 'op.drop_table("old")'
    entry = dict(sha256=hashlib.sha256(source.encode()).hexdigest(),
                 reason='Unused table after completed contract window',
                 compatibility='N and N-1 no longer read or write this table',
                 rollback='Restore archived data with reviewed forward migration',
                 review='https://github.com/Georlan/sistema-gourmet-bistro/pull/1')
    assert gate.exception_valid(entry, source)
    assert not gate.exception_valid(entry, source + '\n')
    assert not gate.exception_valid({}, source)
