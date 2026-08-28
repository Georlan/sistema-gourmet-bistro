import os
import secrets
from urllib.parse import urlsplit

OFFICIAL_PUBLIC_FRONTEND_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"


def normalize_cors_origin(raw: str) -> str:
    """
    Normaliza e valida uma origem CORS individual usando urlsplit.
    Exige esquema (http/https) e hostname válidos sem caminhos, consultas, fragmentos ou credenciais.
    Normaliza portas padrão (443 para https, 80 para http) omitindo o sufixo.
    Lança RuntimeError seguro caso a configuração seja inválida.
    """
    raw_str = raw.strip()
    if not raw_str or "*" in raw_str:
        raise RuntimeError("Configuração de CORS inválida: origens com wildcard '*' ou vazias não são permitidas.")

    try:
        parts = urlsplit(raw_str)
    except Exception as e:
        raise RuntimeError("Configuração de CORS inválida: formato de URL incorreto.") from e

    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise RuntimeError(f"Configuração de CORS inválida: esquema '{scheme}' não suportado. Use apenas http ou https.")

    if not parts.hostname:
        raise RuntimeError("Configuração de CORS inválida: hostname ausente na origem.")

    if parts.username or parts.password:
        raise RuntimeError("Configuração de CORS inválida: credenciais de usuário na URL não são permitidas.")

    if parts.path and parts.path != "/":
        raise RuntimeError("Configuração de CORS inválida: origens não podem conter caminhos (path).")

    if parts.query:
        raise RuntimeError("Configuração de CORS inválida: origens não podem conter parâmetros de consulta (query).")

    if parts.fragment:
        raise RuntimeError("Configuração de CORS inválida: origens não podem conter fragmentos (#).")

    try:
        port = parts.port
    except ValueError as e:
        raise RuntimeError("Configuração de CORS inválida: porta incorreta ou fora do intervalo.") from e

    if port is not None:
        if not (1 <= port <= 65535):
            raise RuntimeError("Configuração de CORS inválida: porta fora do intervalo válido.")
        
        # Omitir portas padrão na normalização
        if (scheme == "https" and port == 443) or (scheme == "http" and port == 80):
            port_suffix = ""
        else:
            port_suffix = f":{port}"
    else:
        port_suffix = ""

    hostname = parts.hostname.lower()
    return f"{scheme}://{hostname}{port_suffix}"


def normalize_supabase_url(raw: str, environment: str) -> str:
    """Valida a URL do projeto sem assumir silenciosamente um tenant externo."""
    value = (raw or "").strip()
    env = (environment or "production").strip().lower()

    if not value:
        return ""

    try:
        parts = urlsplit(value)
        port = parts.port
    except (TypeError, ValueError) as exc:
        raise RuntimeError("SUPABASE_URL inválida: formato incorreto.") from exc

    allowed_schemes = {"http", "https"} if env in {"development", "test"} else {"https"}
    if parts.scheme.lower() not in allowed_schemes or not parts.hostname:
        raise RuntimeError(
            "SUPABASE_URL inválida: use uma URL HTTPS válida em produção."
        )
    if parts.username or parts.password:
        raise RuntimeError("SUPABASE_URL inválida: credenciais não são permitidas.")
    if parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise RuntimeError(
            "SUPABASE_URL inválida: informe apenas a origem, sem caminho, consulta ou fragmento."
        )

    scheme = parts.scheme.lower()
    hostname = parts.hostname.lower()
    port_suffix = f":{port}" if port is not None else ""
    return f"{scheme}://{hostname}{port_suffix}"


class Settings:
    PROJECT_NAME: str = "Haute Cuisine Controller - Kôma"
    PROJECT_VERSION: str = "3.5"
    
    # Database
    SQLITE_DB_FILE: str = "bistro.db"
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///./{SQLITE_DB_FILE}")
    MIGRATION_DATABASE_URL: str = os.getenv("MIGRATION_DATABASE_URL", DATABASE_URL)
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "5"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "5"))
    DB_POOL_TIMEOUT: int = int(os.getenv("DB_POOL_TIMEOUT", "15"))
    DB_POOL_RECYCLE: int = int(os.getenv("DB_POOL_RECYCLE", "1800"))
    
    # Sentry DSN
    SENTRY_DSN: str = os.getenv("SENTRY_DSN", "")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    if not SECRET_KEY:
        raise RuntimeError("A variável de ambiente 'SECRET_KEY' é obrigatória e não foi configurada.")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 days
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
    
    # CORS Configuration
    CORS_ALLOWED_ORIGINS: str = os.getenv("CORS_ALLOWED_ORIGINS", "")
    CORS_ALLOW_CREDENTIALS: bool = (
        os.getenv("CORS_ALLOW_CREDENTIALS", "false").lower() == "true"
    )
    WEBSOCKET_ALLOW_MISSING_ORIGIN: bool = (
        os.getenv("WEBSOCKET_ALLOW_MISSING_ORIGIN", "false").lower() == "true"
    )

    def get_cors_allowed_origins(self) -> list[str]:
        """
        Retorna a lista normalizada e estrita de origens permitidas para CORS.

        Em produção genérica não adicionamos localhost nem wildcards implícitos.
        Quando o backend está rodando no Railway, porém, a origem HTTPS exata do
        frontend público oficial do KÔMA é sempre autorizada. Isso mantém o
        checkout first-party funcional mesmo se a variável CORS_ALLOWED_ORIGINS
        for removida ou sobrescrita no ambiente de deploy.
        """
        raw_origins = [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]
        
        normalized: list[str] = []
        for origin_str in raw_origins:
            clean_origin = normalize_cors_origin(origin_str)
            if clean_origin not in normalized:
                normalized.append(clean_origin)

        running_on_railway = bool(
            os.getenv("RAILWAY_PROJECT_ID")
            or os.getenv("RAILWAY_ENVIRONMENT_ID")
            or os.getenv("RAILWAY_SERVICE_ID")
        )
        if running_on_railway:
            official_origin = normalize_cors_origin(OFFICIAL_PUBLIC_FRONTEND_ORIGIN)
            if official_origin not in normalized:
                normalized.insert(0, official_origin)
                
        env = os.getenv("ENVIRONMENT", "production").lower()
        if not normalized and env in ("development", "test"):
            local_defaults = [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                OFFICIAL_PUBLIC_FRONTEND_ORIGIN,
            ]
            for loc in local_defaults:
                norm_loc = normalize_cors_origin(loc)
                if norm_loc not in normalized:
                    normalized.append(norm_loc)
                    
        return normalized

    # ENCRYPTION_KEY environment check
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")
    if not ENCRYPTION_KEY:
        raise RuntimeError("A variável de ambiente 'ENCRYPTION_KEY' é obrigatória e não foi configurada.")

    # Hardware/Printer
    # A G250/ESC-POS de 80 mm comporta 48 colunas em Font A. O valor antigo
    # (40) deixava uma faixa grande do papel sem uso e comprimía a leitura.
    PRINTER_WIDTH: int = int(os.getenv("PRINTER_WIDTH", "48"))

    KOMA_TEST_PREMIUM_RESTAURANTE_IDS: str = os.getenv(
        "KOMA_TEST_PREMIUM_RESTAURANTE_IDS",
        "1,2",
    )
    SMARTPOS_INTENT_TTL_MINUTES: int = max(
        1,
        int(os.getenv("SMARTPOS_INTENT_TTL_MINUTES", "15")),
    )

    # WhatsApp Automation Toggle (MVP: Default = False)
    KOMA_WHATSAPP_AUTOMATION_ENABLED: bool = (
        os.getenv("KOMA_WHATSAPP_AUTOMATION_ENABLED", "false").lower() == "true"
    )
    KOMA_WHATSAPP_PROVIDER: str = os.getenv(
        "KOMA_WHATSAPP_PROVIDER",
        "evolution",
    ).strip().lower()

    # Evolution API (WhatsApp) - Opcional / Reservado para futuro
    EVOLUTION_API_URL: str = os.getenv("EVOLUTION_API_URL", "")
    EVOLUTION_API_KEY: str = os.getenv("EVOLUTION_API_KEY", "")
    EVOLUTION_INSTANCE_NAME: str = os.getenv("EVOLUTION_INSTANCE_NAME", "")
    EVOLUTION_API_ORIGIN: str = os.getenv("EVOLUTION_API_ORIGIN", "")
    EVOLUTION_REQUEST_TIMEOUT_SECONDS: float = max(
        1.0,
        min(float(os.getenv("EVOLUTION_REQUEST_TIMEOUT_SECONDS", "10")), 30.0),
    )

    # Meta Cloud API (WhatsApp Oficial) - Opcional / Reservado para futuro
    META_VERIFY_TOKEN: str = os.getenv("META_VERIFY_TOKEN", "")
    META_APP_SECRET: str = os.getenv("META_APP_SECRET", "")
    META_PHONE_NUMBER_ID: str = os.getenv("META_PHONE_NUMBER_ID", "")
    META_ACCESS_TOKEN: str = os.getenv("META_ACCESS_TOKEN", os.getenv("META_ACESS_TOKEN", ""))
    META_USE_TEMPLATE: bool = os.getenv("META_USE_TEMPLATE", "False").lower() == "true"
    META_OTP_TEMPLATE_NAME: str = os.getenv("META_OTP_TEMPLATE_NAME", "koma_otp")

    # Supabase (Storage & Service Role)
    SUPABASE_URL: str = normalize_supabase_url(
        os.getenv("SUPABASE_URL", ""),
        os.getenv("ENVIRONMENT", "production"),
    )
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))

    if os.getenv("ENVIRONMENT") != "test":
        if SUPABASE_SERVICE_ROLE_KEY and SUPABASE_SERVICE_ROLE_KEY.startswith("sb_publishable_"):
            raise RuntimeError("A chave 'SUPABASE_SERVICE_ROLE_KEY' fornecida é uma chave pública (publishable). É obrigatório utilizar a Service Role Key do Supabase no backend.")

    if META_ACCESS_TOKEN and not META_PHONE_NUMBER_ID:
        import logging
        logging.getLogger("koma.config").warning(
            "[META CLOUD API WARNING CRÍTICO] META_ACCESS_TOKEN está preenchido mas META_PHONE_NUMBER_ID está vazio! O envio de WhatsApp irá falhar."
        )

    if KOMA_WHATSAPP_PROVIDER not in {"evolution", "meta"}:
        raise RuntimeError(
            "KOMA_WHATSAPP_PROVIDER deve ser 'evolution' ou 'meta'."
        )

settings = Settings()
