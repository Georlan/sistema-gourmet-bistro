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
    # Mantém uma instância da API em até 10 conexões simultâneas por padrão.
    # Dimensione o total considerando todas as réplicas e o limite do provedor.
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "5"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "5"))
    DB_POOL_TIMEOUT: int = int(os.getenv("DB_POOL_TIMEOUT", "15"))
    DB_POOL_RECYCLE: int = int(os.getenv("DB_POOL_RECYCLE", "1800"))
    
    # Sentry DSN (Vazio por padrão em conformidade com P0.1 - lido exclusivamente de variável de ambiente)
    SENTRY_DSN: str = os.getenv("SENTRY_DSN", "")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    if not SECRET_KEY:
        raise RuntimeError("A variável de ambiente 'SECRET_KEY' é obrigatória e não foi configurada.")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 days (43200 minutes) to keep waiters logged in
    CUSTOMER_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("CUSTOMER_TOKEN_EXPIRE_MINUTES", "43200")
    )
    CUSTOMER_OTP_TTL_SECONDS: int = int(
        os.getenv("CUSTOMER_OTP_TTL_SECONDS", "300")
    )
    CUSTOMER_OTP_RESEND_SECONDS: int = int(
        os.getenv("CUSTOMER_OTP_RESEND_SECONDS", "60")
    )
    CUSTOMER_OTP_WINDOW_SECONDS: int = int(
        os.getenv("CUSTOMER_OTP_WINDOW_SECONDS", "900")
    )
    CUSTOMER_OTP_MAX_SENDS: int = int(
        os.getenv("CUSTOMER_OTP_MAX_SENDS", "5")
    )
    CUSTOMER_OTP_MAX_ATTEMPTS: int = int(
        os.getenv("CUSTOMER_OTP_MAX_ATTEMPTS", "5")
    )
    CUSTOMER_OTP_MAX_IP_REQUESTS: int = int(
        os.getenv("CUSTOMER_OTP_MAX_IP_REQUESTS", "20")
    )
    
    # ENCRYPTION_KEY environment check
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")
    if not ENCRYPTION_KEY:
        raise RuntimeError("A variável de ambiente 'ENCRYPTION_KEY' é obrigatória e não foi configurada.")

    # Hardware/Printer
    PRINTER_NAME: str = os.getenv("PRINTER_NAME", "Generic / Text Only")
    SIMULATE_PRINTER: bool = os.getenv("SIMULATE_PRINTER", "True").lower() == "true"
    PRINTER_WIDTH: int = int(os.getenv("PRINTER_WIDTH", "40"))
    PRINT_JOBS_DIR: str = os.getenv("PRINT_JOBS_DIR", "./print_jobs")

    # Libera recursos Premium somente para restaurantes explicitamente
    # autorizados durante homologação. Não altera a assinatura armazenada.
    KOMA_TEST_PREMIUM_RESTAURANTE_IDS: str = os.getenv(
        "KOMA_TEST_PREMIUM_RESTAURANTE_IDS",
        "1",  # tenant de homologação atual; definir "" antes de uso comercial
    )

    # Evolution API (WhatsApp)
    EVOLUTION_API_URL: str = os.getenv("EVOLUTION_API_URL", "")
    EVOLUTION_API_KEY: str = os.getenv("EVOLUTION_API_KEY", "")
    EVOLUTION_INSTANCE_NAME: str = os.getenv("EVOLUTION_INSTANCE_NAME", "")

    # Meta Cloud API (WhatsApp Oficial)
    META_VERIFY_TOKEN: str = os.getenv("META_VERIFY_TOKEN", "1505")
    META_PHONE_NUMBER_ID: str = os.getenv("META_PHONE_NUMBER_ID", "")
    META_ACCESS_TOKEN: str = os.getenv("META_ACCESS_TOKEN", os.getenv("META_ACESS_TOKEN", ""))
    META_USE_TEMPLATE: bool = os.getenv("META_USE_TEMPLATE", "False").lower() == "true"
    META_OTP_TEMPLATE_NAME: str = os.getenv("META_OTP_TEMPLATE_NAME", "koma_otp")


    # Supabase (Storage & Service Role)
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "https://iiowhekvahxiepwcdidm.supabase.co")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))

    if os.getenv("ENVIRONMENT") != "test":
        if SUPABASE_SERVICE_ROLE_KEY and SUPABASE_SERVICE_ROLE_KEY.startswith("sb_publishable_"):
            raise RuntimeError("A chave 'SUPABASE_SERVICE_ROLE_KEY' fornecida é uma chave pública (publishable). É obrigatório utilizar a Service Role Key do Supabase no backend.")

    if META_ACCESS_TOKEN and not META_PHONE_NUMBER_ID:
        import logging
        logging.getLogger("koma.config").warning(
            "[META CLOUD API WARNING CRÍTICO] META_ACCESS_TOKEN está preenchido mas META_PHONE_NUMBER_ID está vazio! O envio de WhatsApp irá falhar."
        )

settings = Settings()
