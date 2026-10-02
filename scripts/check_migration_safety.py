#!/usr/bin/env python3
"""Review changed Alembic upgrades using AST, without importing/executing them.

Historical revisions are immutable. Raw/dynamic SQL is review-required, never
assumed safe. An exception is bound to the exact file hash and recorded review.
This catches obvious hazards; it cannot prove N/N-1 or estimate lock duration.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXCEPTIONS = ROOT / 'docs/engineering/migration-safety-exceptions.json'


def hazards(source):
    tree = ast.parse(source)
    findings = set()
    # Exclude downgrade only: helpers used by upgrade also require inspection.
    nodes = [node for node in tree.body if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name != 'downgrade']
    for top in nodes:
        for node in ast.walk(top):
            if isinstance(node, (ast.For, ast.While, ast.AsyncFor)):
                findings.add('loop/backfill requires bounded-work review')
            if not isinstance(node, ast.Call):
                continue
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', '')
            kw = {item.arg: item.value for item in node.keywords}
            if name in {'drop_column', 'drop_table', 'rename_table', 'drop_constraint', 'drop_index'}:
                findings.add(f'destructive operation: {name}')
            if name == 'alter_column' and any(k in kw for k in ('new_column_name', 'type_', 'nullable', 'server_default')):
                findings.add('alter_column changes existing contract')
            if name == 'add_column':
                for column in node.args:
                    if not isinstance(column, ast.Call):
                        continue
                    options = {item.arg: item.value for item in column.keywords}
                    nullable = options.get('nullable')
                    default = options.get('server_default')
                    if isinstance(nullable, ast.Constant) and nullable.value is False and (default is None or isinstance(default, ast.Constant) and default.value is None):
                        findings.add('required column without server_default')
            if name in {'execute', 'exec_driver_sql', 'executemany', 'bulk_insert'}:
                findings.add('SQL/data operation requires compatibility and workload review')
    return sorted(findings)


def exception_valid(entry, source):
    return (isinstance(entry, dict)
            and entry.get('sha256') == hashlib.sha256(source.encode()).hexdigest()
            and all(isinstance(entry.get(k), str) and len(entry[k].strip()) >= 20
                    for k in ('reason', 'compatibility', 'rollback'))
            and str(entry.get('review', '')).startswith('https://github.com/Georlan/sistema-gourmet-bistro/pull/'))


def check(base):
    changes = subprocess.check_output(['git', 'diff', '--name-status', '--no-renames', base, 'HEAD', '--', 'backend/alembic/versions/*.py'], cwd=ROOT, text=True)
    exceptions = json.loads(EXCEPTIONS.read_text())
    failures = []
    for line in changes.splitlines():
        status, name = line.split('\t', 1)
        path = ROOT / name
        if status != 'A':
            failures.append(f'{name}: historical revision changed/deleted; add a new revision')
            continue
        source = path.read_text()
        issues = hazards(source)
        if issues and not exception_valid(exceptions.get(name), source):
            failures.append(f'{name}: ' + '; '.join(issues))
    if failures:
        print('\n'.join(failures))
        return 1
    print('Migration safety: no unreviewed obvious compatibility hazards in changed revisions.')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    raise SystemExit(check(parser.parse_args().base))
