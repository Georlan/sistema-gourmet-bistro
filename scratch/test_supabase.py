import os
from sqlalchemy import create_engine

# Read the .env file manually
db_url = None
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            if line.startswith("DATABASE_URL="):
                db_url = line.split("=", 1)[1].strip().strip('"').strip("'")

if not db_url:
    print("DATABASE_URL not found in .env")
    exit(1)

print(f"Connecting to database: {db_url.split('@')[-1]} (password masked)")

try:
    engine = create_engine(db_url)
    with engine.connect() as conn:
        print("SUCCESS! Successfully connected to Supabase PostgreSQL database.")
except Exception as e:
    print(f"FAILED to connect to Supabase: {e}")
