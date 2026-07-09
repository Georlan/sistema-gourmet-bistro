import json
import uuid
import datetime
from app.database import engine, Base, SessionLocal
from app.models import Restaurante, Usuario, Categoria, Produto, Mesa, ObservacaoPredefinida, Motoboy, Comanda, Item, Lancamento, ConfiguracaoRestaurante, ConfiguracaoIA
from app.security import get_password_hash

def seed_database():
    print("Recriando e limpando o banco de dados...")
    # Drop and recreate tables for a fresh clean seed
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    try:
        print("Carregando dump do cardápio oficial...")
        with open("backend/dump.json", "r", encoding="utf-8") as f:
            dump_data = json.load(f)
            
        print("Semeando Banco de Dados...")
        
        # 0. Cadastrar Restaurante Padrão (ID=1)
        restaurante = Restaurante(id=1, nome="Kôma Bistrô", plano="pocket")
        db.add(restaurante)
        db.commit()

        # 1. Cadastrar Usuários (Garçons, Caixas e Administradores)
        usuarios_data = [
            {"id": "g-01", "nome": "Georlan", "usuario": "georlan", "senha": "123", "role": "garcom"},
            {"id": "g-02", "nome": "Mateus", "usuario": "mateus", "senha": "123", "role": "garcom"},
            {"id": "g-03", "nome": "Sarah", "usuario": "sarah", "senha": "123", "role": "garcom"},
            {"id": "g-04", "nome": "Thiago", "usuario": "thiago", "senha": "123", "role": "garcom"},
            {"id": "c-01", "nome": "Caixa 1", "usuario": "caixa1", "senha": "123", "role": "caixa"},
            {"id": "a-01", "nome": "Admin", "usuario": "admin", "senha": "123", "role": "admin"},
        ]
        
        for u in usuarios_data:
            novo_usuario = Usuario(
                id=u["id"],
                restaurante_id=1,
                nome=u["nome"],
                usuario=u["usuario"],
                senha_hash=get_password_hash(u["senha"]),
                role=u["role"]
            )
            db.add(novo_usuario)
            print(f"Usuário cadastrado: {u['nome']} ({u['role']})")

        # 2. Cadastrar Mesas (1 a 30)
        for i in range(1, 31):
            nova_mesa = Mesa(id=i, restaurante_id=1, capacidade=4, nome=None)
            db.add(nova_mesa)
        print("30 Mesas cadastradas com sucesso.")

        # Mapeamento estático de ID para as categorias do frontend
        category_mapping = {
            "Hambúrgueres Bovinos": "cat-hamburgueres-bovinos",
            "Hambúrgueres de Frango": "cat-frango",
            "Hambúrgueres Suínos": "cat-suinos",
            "Baguetes": "cat-baguetes",
            "Pastéis Tradicionais": "cat-pasteis-trad",
            "Pastelões Especiais": "cat-pasteloes",
            "Pastéis Doces": "cat-pasteis-doces",
            "Petiscos": "cat-petiscos",
            "Combos Promocionais": "cat-combos",
            "Sucos": "cat-sucos",
            "Refrigerantes e Águas": "cat-refri",
            "Cervejas": "cat-cervejas",
            "Bebidas Quentes": "cat-quentes"
        }

        # 3. Cadastrar Categorias
        for cat_name in dump_data["categories"]:
            cat_id = category_mapping.get(cat_name)
            if cat_id:
                destino = "COZINHA"
                if cat_id in ["cat-refri", "cat-cervejas"]:
                    destino = "NENHUM"
                nova_categoria = Categoria(id=cat_id, restaurante_id=1, nome=cat_name, destino_impressao=destino)
                db.add(nova_categoria)
        print(f"{len(dump_data['categories'])} Categorias cadastradas com sucesso.")

        # 4. Cadastrar Observações Predefinidas por Categoria
        observacoes_por_categoria = {
            "cat-hamburgueres-bovinos": ["Sem cebola", "Sem cheddar", "Sem molhos", "Pra viagem", "Sem salada"],
            "cat-frango": ["Sem cebola", "Sem cheddar", "Sem molhos", "Pra viagem", "Sem salada"],
            "cat-suinos": ["Sem cebola", "Sem cheddar", "Sem molhos", "Pra viagem", "Sem salada"],
            "cat-baguetes": ["Sem salada", "Sem maionese", "Sem queijo", "Bem quente", "Pão extra crocante"],
            "cat-pasteis-trad": ["Pra viagem", "Bem frito", "Sem milho", "Borda crocante"],
            "cat-pasteloes": ["Pra viagem", "Bem frito", "Sem milho", "Borda crocante"],
            "cat-pasteis-doces": ["Pra viagem", "Com canela", "Sem canela", "Extra chocolate"],
            "cat-petiscos": ["Molho à parte", "Bacon crocante", "Pra viagem"],
            "cat-combos": ["Pra viagem", "Refrigerante gelado"],
            "cat-sucos": ["Sem açúcar", "Com adoçante", "Com gelo", "Sem gelo"],
            "cat-refri": ["Gelado", "Natural", "Com limão e gelo"],
            "cat-cervejas": ["Gelada", "Copo descartável"],
            "cat-quentes": ["Com gelo", "Dose pura"]
        }

        for cat_id, obs_list in observacoes_por_categoria.items():
            for texto in obs_list:
                nova_obs = ObservacaoPredefinida(categoria_id=cat_id, texto=texto)
                db.add(nova_obs)
        print("Observações predefinidas vinculadas com sucesso.")

        # 5. Cadastrar todos os produtos do cardápio oficial
        for p in dump_data["products"]:
            cat_id = category_mapping.get(p["categoria"])
            if not cat_id:
                continue
            
            novo_produto = Produto(
                id=p["id"],
                restaurante_id=1,
                nome=p["nome"],
                categoria_id=cat_id,
                preco=float(p["preco"]),
                descricao=p.get("descricao", ""),
                imagem=p.get("imagem", ""),
                ativo=True
            )
            db.add(novo_produto)
        
        # 6. Semeando Motoboys
        motoboys_data = [
            {"id": 1, "nome": "Pedro Silva", "telefone": "(81) 98888-1122"},
            {"id": 2, "nome": "Carlos Roberto", "telefone": "(81) 98777-3344"},
            {"id": 3, "nome": "Marcos Junior", "telefone": "(81) 98666-5566"}
        ]
        for m in motoboys_data:
            novo_motoboy = Motoboy(id=m["id"], nome=m["nome"], telefone=m["telefone"], ativo=True)
            db.add(novo_motoboy)
        print("Motoboys semeados com sucesso!")

        # 7. Configurações padrão do Restaurante (modo bistrô — salão sem delivery)
        config_restaurante = ConfiguracaoRestaurante(
            restaurante_id=1,
            nicho="hamburgueria",
            mapa_mesas_ativo=True,
            delivery_ativo=False,           # Modo bistrô: sem delivery
            taxa_servico_ativa=True,
            taxa_servico_padrao=10.0,
            unificar_vias_delivery=False,
            modo_exclusivo_salao=True       # Oculta módulos de delivery na UI
        )
        db.add(config_restaurante)

        # 8. Configurações de IA padrão
        config_ia = ConfiguracaoIA(
            permitir_descontos=False,
            desconto_maximo=10.0,
            permitir_upsell=True,
            tom_de_voz="direto",
            teto_interacoes=5
        )
        db.add(config_ia)
        print("Configurações do restaurante semeadas com sucesso!")

        # Commit here so we can query products next
        db.commit()

        # 9. Semeando comanda de exemplo na Mesa 1 para demonstração
        comanda_del = Comanda(
            id=f"c-{uuid.uuid4().hex[:8]}",
            restaurante_id=1,
            mesa_id=None,
            garcom_id="c-01",
            tipo="Delivery",
            identificador="Maria Oliveira",
            numero_pedido=101,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc),
            delivery_status="analise",
            delivery_telefone="(81) 98888-2233",
            delivery_endereco="Av. Conselheiro Aguiar, 2300, Apto 502 - Boa Viagem",
            delivery_taxa=7.0
        )
        db.add(comanda_del)
        
        # Query products
        pastel = db.query(Produto).filter(Produto.nome.like("%Pastel%Carne%")).first()
        coca = db.query(Produto).filter(Produto.nome.like("%Coca-Cola%")).first()
        
        if not pastel:
            pastel = db.query(Produto).first()
        if not coca:
            coca = db.query(Produto).first()
            
        # Create launch and items
        lancamento = Lancamento(
            id=f"l-{uuid.uuid4().hex[:8]}",
            comanda_id=comanda_del.id,
            garcom_id="c-01",
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(lancamento)
        
        # 2x Pastel
        for _ in range(2):
            item_p = Item(
                id=f"i-{uuid.uuid4().hex[:8]}",
                comanda_id=comanda_del.id,
                lancamento_id=lancamento.id,
                produto_id=pastel.id,
                preco_unit=pastel.preco,
                observacao="Bem frito",
                status="entregue",
                cliente_nome="Maria Oliveira"
            )
            db.add(item_p)
            
        # 1x Coca
        item_c = Item(
            id=f"i-{uuid.uuid4().hex[:8]}",
            comanda_id=comanda_del.id,
            lancamento_id=lancamento.id,
            produto_id=coca.id,
            preco_unit=coca.preco,
            observacao="Gelado",
            status="entregue",
            cliente_nome="Maria Oliveira"
        )
        db.add(item_c)

        db.commit()
        print(f"{len(dump_data['products'])} Produtos semeados com sucesso!")
        print("Delivery inicial semeado com sucesso!")
        print("Banco de dados semeado com sucesso!")
        
    except Exception as e:
        db.rollback()
        print(f"Erro ao semear o banco de dados: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()

