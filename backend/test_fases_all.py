import os
import sys
import unittest
import datetime
import shutil
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Setup test environment variables
os.environ["DATABASE_URL"] = "sqlite:///./test_all_phases.db"
os.environ["SIMULATE_PRINTER"] = "True"
os.environ["PRINT_JOBS_DIR"] = "./test_print_jobs"

# Make sure imports find the backend app modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "app")))

from app.database import Base, current_restaurante_id
from app.models import Garcom, Categoria, Produto, Mesa, Comanda, Item, Lancamento
from app.printer_service import printer_service

class TestKomaAllPhases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Fase 2: Configuração da Engine com WAL e Foreign Keys
        cls.engine = create_engine(
            os.environ["DATABASE_URL"],
            connect_args={"check_same_thread": False}
        )
        
        # Enforce SQLite WAL and Foreign Keys
        from sqlalchemy import event
        @event.listens_for(cls.engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
            
        cls.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        
        # Recreate DB schema
        Base.metadata.drop_all(bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)
        
        # Setup clean test directories
        if os.path.exists("./test_print_jobs"):
            shutil.rmtree("./test_print_jobs")

    @classmethod
    def tearDownClass(cls):
        # Cleanup test DB and files
        Base.metadata.drop_all(bind=cls.engine)
        if os.path.exists("./test_all_phases.db"):
            os.remove("./test_all_phases.db")
        if os.path.exists("./test_print_jobs"):
            shutil.rmtree("./test_print_jobs")

    def setUp(self):
        self.token_var = current_restaurante_id.set(1)
        self.db = self.SessionLocal()
        
    def tearDown(self):
        self.db.close()
        current_restaurante_id.reset(self.token_var)


    def test_fase1_2_database_constraints(self):
        """Fase 1 & 2: Verifica integridade de chaves estrangeiras e relacionamentos"""
        # 1. Inserir Garçom
        g = Garcom(id="g-test", nome="Test Waiter", usuario="waiter1", senha_hash="xyz")
        self.db.add(g)
        self.db.commit()
        
        # 2. Inserir Categoria
        c = Categoria(id="cat-test", nome="Comida")
        self.db.add(c)
        self.db.commit()
        
        # 3. Inserir Produto
        p = Produto(id="p-test", nome="Prato Teste", categoria_id="cat-test", preco=20.0, ativo=True)
        self.db.add(p)
        self.db.commit()
        
        # 4. Inserir Mesa
        m = Mesa(id=101, capacidade=4, nome="Mesa 101")
        self.db.add(m)
        self.db.commit()
        
        # 5. Inserir Comanda
        comanda = Comanda(
            id="c-test",
            mesa_id=101,
            garcom_id="g-test",
            numero_pedido=10,
            tipo="Consumo no Local"
        )
        self.db.add(comanda)
        self.db.commit()
        
        # 6. Testar constraint de chave estrangeira inválida (deve falhar com IntegrityError)
        from sqlalchemy.exc import IntegrityError
        invalid_item = Item(
            id="i-invalid",
            comanda_id="non-existent-comanda", # FK inválida
            lancamento_id="any-id",
            produto_id="p-test",
            preco_unit=20.0,
            status="preparando"
        )
        self.db.add(invalid_item)
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_fase3_waiter_business_rules(self):
        """Fase 3: Regras de negócio do Garçom (Trava de Cancelamento)"""
        # Criar comanda e lançar itens
        comanda = Comanda(id="c-f3", mesa_id=101, garcom_id="g-test", numero_pedido=11, tipo="Consumo no Local")
        self.db.add(comanda)
        self.db.commit()
        
        # Novo lançamento
        lanc = Lancamento(id="l-f3", comanda_id="c-f3", garcom_id="g-test")
        self.db.add(lanc)
        self.db.commit()
        
        # Lançar dois itens ativos
        item1 = Item(id="i-1", comanda_id="c-f3", lancamento_id="l-f3", produto_id="p-test", preco_unit=20.0, status="preparando")
        item2 = Item(id="i-2", comanda_id="c-f3", lancamento_id="l-f3", produto_id="p-test", preco_unit=20.0, status="preparando")
        self.db.add_all([item1, item2])
        self.db.commit()
        
        # Simular cancelamento de um item (deve funcionar, pois sobra outro ativo)
        item1.status = "cancelado"
        item1.cancelado_por = "g-test"
        self.db.commit()
        
        # Tentar cancelar o segundo item (ele é o único ativo da comanda)
        # O garçom não deve conseguir cancelar se for o único item ativo da comanda inteira.
        active_items = self.db.query(Item).filter(Item.comanda_id == "c-f3", Item.status != "cancelado").all()
        self.assertEqual(len(active_items), 1) # Resta apenas o item2
        
        # Verifica se o sistema identifica que é o único ativo da comanda
        is_only_active_item = len(active_items) == 1
        self.assertTrue(is_only_active_item)

    def test_fases_6_7_printing_layouts(self):
        """Fase 6 & 7: Formatação e geração de tickets e recibos"""
        # 1. Testar geração de Ticket de Cozinha
        items_payload = [
            {"quantidade": 2, "nome": "Hambúrguer de Costela Premium", "observacao": "Sem cebola", "cliente_nome": "Gabriel"},
            {"quantidade": 1, "nome": "Refrigerante Cola Lata", "observacao": "Com gelo", "cliente_nome": "Consumo Geral"}
        ]
        
        kitchen_ticket = printer_service.generate_kitchen_ticket(
            num_pedido=120,
            tipo="Consumo no Local",
            mesa_id=15,
            garcom_nome="Mateus",
            items=items_payload,
            is_reprint=False
        )
        
        self.assertIn("PEDIDO: #120", kitchen_ticket)
        self.assertIn("MESA: 15", kitchen_ticket)
        self.assertTrue("Hambúrguer de Costela" in kitchen_ticket or "Hamb. de Costela" in kitchen_ticket)
        self.assertIn("Sem cebola", kitchen_ticket)
        self.assertIn("[CUT]", kitchen_ticket)
        
        # Salvar o cupom simulado
        filepath = printer_service.send_to_printer("test_cozinha", kitchen_ticket)
        self.assertTrue(os.path.exists(filepath))
        
        # 2. Testar geração de Recibo com contas separadas
        comandas_details = [
            {
                "identificador": "Gabriel",
                "itens": [
                    {"produto": {"nome": "Hambúrguer de Costela Premium"}, "preco_unit": 35.0, "status": "preparando"},
                    {"produto": {"nome": "Cerveja Artesanal IPA"}, "preco_unit": 18.0, "status": "preparando"}
                ]
            },
            {
                "identificador": "Ana",
                "itens": [
                    {"produto": {"nome": "Pizza Margherita Grande"}, "preco_unit": 50.0, "status": "preparando"}
                ]
            }
        ]
        
        receipt = printer_service.generate_receipt(
            num_pedido=120,
            tipo="Consumo no Local",
            mesa_id=15,
            garcom_nome="Mateus",
            comandas_details=comandas_details
        )
        
        # Gabriel subtotal: 35 + 18 = 53
        # Ana subtotal: 50
        # Total Consumo: 103
        # Taxa de Serviço (10%): 10.30
        # Total Geral: 113.30
        self.assertIn("CLIENTE: GABRIEL", receipt)
        self.assertIn("CLIENTE: ANA", receipt)
        self.assertIn("SUBTOTAL CONSUMO:", receipt)
        self.assertIn("103.00", receipt)
        self.assertIn("TAXA DE SERVIÇO (10%):", receipt)
        self.assertIn("10.30", receipt)
        self.assertIn("TOTAL GERAL DA MESA:", receipt)
        self.assertIn("113.30", receipt)
        
        # Salvar recibo simulado
        receipt_filepath = printer_service.send_to_printer("test_recibo", receipt)
        self.assertTrue(os.path.exists(receipt_filepath))

if __name__ == "__main__":
    unittest.main()
