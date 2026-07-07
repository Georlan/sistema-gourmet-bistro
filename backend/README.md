# Backend - Kôma (FastAPI + SQLite)

Esta pasta contém o backend local da aplicação, estruturado para persistência de dados em SQLite e controle físico de impressão em máquinas Windows.

---

## Pré-requisitos

- Python 3.10 ou superior instalado na máquina do caixa (Windows).

---

## Como Configurar e Rodar o Servidor

1. **Abra o terminal (Prompt de Comando ou PowerShell)** na pasta `backend/` deste projeto.

2. **Crie um ambiente virtual do Python (Virtualenv):**
   ```bash
   python -m venv venv
   ```

3. **Ative o ambiente virtual:**
   - **No Windows (PowerShell):**
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
   - **No Windows (CMD):**
     ```cmd
     .\venv\Scripts\activate.bat
     ```
   - **No Linux/macOS:**
     ```bash
     source venv/bin/activate
     ```

4. **Instale as dependências:**
   ```bash
   pip install -r requirements.txt
   ```

5. **Inicie o servidor de desenvolvimento:**
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

O servidor estará rodando em [http://localhost:8000](http://localhost:8000).
A documentação interativa da API (Swagger UI) estará disponível em [http://localhost:8000/docs](http://localhost:8000/docs).
