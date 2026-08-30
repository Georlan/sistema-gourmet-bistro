import ast
import os
from pathlib import Path


def test_ast_lancamento_is_exclusively_instantiated_in_order_service():
    """Valida via AST que nenhum código de produção em backend/app instancia Lancamento(...)
    fora do método canônico OrderApplicationService.create_order.
    """
    app_dir = Path(__file__).resolve().parent.parent.parent / "app"
    assert app_dir.exists(), f"Diretório da aplicação não encontrado: {app_dir}"

    violations = []
    canonical_file = "service.py"
    canonical_method = "create_order"
    canonical_class = "OrderApplicationService"

    for py_file in app_dir.rglob("*.py"):
        # Ignora arquivos de teste ou diretórios ocultos se houver
        if "__pycache__" in str(py_file):
            continue

        try:
            with open(py_file, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=str(py_file))
        except Exception as e:
            violations.append(f"Erro ao analisar {py_file}: {e}")
            continue

        # Rastreia contexto de classes e funções
        class_stack = []
        func_stack = []

        class Visitor(ast.NodeVisitor):
            def visit_ClassDef(self, node):
                class_stack.append(node.name)
                self.generic_visit(node)
                class_stack.pop()

            def visit_FunctionDef(self, node):
                func_stack.append(node.name)
                self.generic_visit(node)
                func_stack.pop()

            def visit_AsyncFunctionDef(self, node):
                func_stack.append(node.name)
                self.generic_visit(node)
                func_stack.pop()

            def visit_Call(self, node):
                func_name = None
                if isinstance(node.func, ast.Name):
                    func_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr

                if func_name == "Lancamento":
                    # Verifica se estamos na declaração permitida
                    current_class = class_stack[-1] if class_stack else None
                    current_func = func_stack[-1] if func_stack else None
                    file_name = py_file.name

                    is_whitelisted = (
                        file_name == canonical_file
                        and current_class == canonical_class
                        and current_func == canonical_method
                    )

                    if not is_whitelisted:
                        rel_path = py_file.relative_to(app_dir)
                        ctx = f"{current_class}.{current_func}" if current_class else (current_func or "<global>")
                        violations.append(
                            f"Instanciação não autorizada de Lancamento(...) em app/{rel_path}:{node.lineno} (no contexto {ctx})"
                        )

                self.generic_visit(node)

        Visitor().visit(tree)

    assert not violations, (
        f"Foram encontradas {len(violations)} instanciações ilegais de Lancamento fora do OrderApplicationService:\n"
        + "\n".join(f"  - {v}" for v in violations)
    )
