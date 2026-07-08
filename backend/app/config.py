import os
import secrets

class Settings:
    PROJECT_NAME: str = "Haute Cuisine Controller - Kôma"
    PROJECT_VERSION: str = "3.5"
    
    # Database
    SQLITE_DB_FILE: str = "bistro.db"
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///./{SQLITE_DB_FILE}")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", secrets.token_hex(32))
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 days (43200 minutes) to keep waiters logged in
    
    # ENCRYPTION_KEY environment check
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")
    if not ENCRYPTION_KEY:
        ENCRYPTION_KEY = "jW-j311rF_qj0Fh_77R-2n1B-Q0v4sK9M1S2T3U4V5o="
        print("[WARNING] ENCRYPTION_KEY is not set in environment. Falling back to insecure key for dev/testing.")

    # Hardware/Printer
    PRINTER_NAME: str = os.getenv("PRINTER_NAME", "Generic / Text Only")
    SIMULATE_PRINTER: bool = os.getenv("SIMULATE_PRINTER", "True").lower() == "true"
    PRINTER_WIDTH: int = int(os.getenv("PRINTER_WIDTH", "40"))
    PRINT_JOBS_DIR: str = os.getenv("PRINT_JOBS_DIR", "./print_jobs")

settings = Settings()
