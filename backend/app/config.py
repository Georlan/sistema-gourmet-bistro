import os
import secrets

class Settings:
    PROJECT_NAME: str = "Haute Cuisine Controller - Kôma"
    PROJECT_VERSION: str = "3.5"
    
    # Database
    SQLITE_DB_FILE: str = "bistro.db"
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///./{SQLITE_DB_FILE}")
    # DDL/migrações usam uma credencial administrativa separada. O runtime
    # deve usar uma role não proprietária e sem BYPASSRLS em DATABASE_URL.
    MIGRATION_DATABASE_URL: str = os.getenv("MIGRATION_DATABASE_URL", DATABASE_URL)
    
    # Sentry DSN (Vazio por padrão em conformidade com P0.1 - lido exclusivamente de variável de ambiente)
    SENTRY_DSN: str = os.getenv("SENTRY_DSN", "")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    if not SECRET_KEY:
        raise RuntimeError("A variável de ambiente 'SECRET_KEY' é obrigatória e não foi configurada.")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 days (43200 minutes) to keep waiters logged in
    
    # ENCRYPTION_KEY environment check
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")
    if not ENCRYPTION_KEY:
        raise RuntimeError("A variável de ambiente 'ENCRYPTION_KEY' é obrigatória e não foi configurada.")

    # Hardware/Printer
    PRINTER_NAME: str = os.getenv("PRINTER_NAME", "Generic / Text Only")
    SIMULATE_PRINTER: bool = os.getenv("SIMULATE_PRINTER", "True").lower() == "true"
    PRINTER_WIDTH: int = int(os.getenv("PRINTER_WIDTH", "40"))
    PRINT_JOBS_DIR: str = os.getenv("PRINT_JOBS_DIR", "./print_jobs")

    # Evolution API (WhatsApp)
    EVOLUTION_API_URL: str = os.getenv("EVOLUTION_API_URL", "")
    EVOLUTION_API_KEY: str = os.getenv("EVOLUTION_API_KEY", "")
    EVOLUTION_INSTANCE_NAME: str = os.getenv("EVOLUTION_INSTANCE_NAME", "")

    # Supabase (Storage & Service Role)
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "https://iiowhekvahxiepwcdidm.supabase.co")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))

    if os.getenv("ENVIRONMENT") != "test":
        if SUPABASE_SERVICE_ROLE_KEY and SUPABASE_SERVICE_ROLE_KEY.startswith("sb_publishable_"):
            raise RuntimeError("A chave 'SUPABASE_SERVICE_ROLE_KEY' fornecida é uma chave pública (publishable). É obrigatório utilizar a Service Role Key do Supabase no backend.")

settings = Settings()
