from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import engine, Base
from .routes import auth, products, tables, orders, websocket, caixa, optimization

# Automatically create sqlite database tables on start if they do not exist
try:
    Base.metadata.create_all(bind=engine)
    from sqlalchemy import text
    with engine.connect() as conn:
        res = conn.execute(text("PRAGMA table_info(configuracoes_restaurante)"))
        columns = [row[1] for row in res.fetchall()]
        if "modo_exclusivo_salao" not in columns:
            conn.execute(text("ALTER TABLE configuracoes_restaurante ADD COLUMN modo_exclusivo_salao BOOLEAN DEFAULT 1"))
            conn.commit()
except Exception as e:
    print(f"Error initializing SQLite Database: {e}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="Backend API local para o App de Garçons e Caixas do Bistrô"
)

# CORS configuration to allow local frontend access (WiFi/Local Network)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits access from any device on the local network (smartphones/tablets)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(tables.router)
app.include_router(orders.router)
app.include_router(websocket.router)
app.include_router(caixa.router)
app.include_router(optimization.router)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "app": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
        "docs": "/docs"
    }
