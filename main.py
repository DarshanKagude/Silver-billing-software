from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
import mysql.connector
from mysql.connector import pooling
import os
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from urllib.parse import urlparse

# ── Load ENV ─────────────────────────────────────────────
load_dotenv()

# ── DATABASE CONFIG ──────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    u = urlparse(DATABASE_URL)
    DB_CONFIG = {
        "host": u.hostname,
        "port": u.port or 3306,
        "user": u.username,
        "password": u.password,
        "database": u.path.lstrip("/")
    }
else:
    DB_CONFIG = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", 3306)),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", "my_sql"),
        "database": os.getenv("DB_NAME", "silver_billing_db")
    }

# 🔍 Debug logs (IMPORTANT)
print("DATABASE_URL:", DATABASE_URL)
print("DB_CONFIG:", DB_CONFIG)

IS_RENDER = os.getenv("RENDER") is not None

# ── DB POOL ──────────────────────────────────────────────
try:
    db_pool = pooling.MySQLConnectionPool(
        pool_name="billing_pool",
        pool_size=5,
        **DB_CONFIG
    )
except mysql.connector.Error as err:
    raise RuntimeError(f"Database connection failed: {err}")

def get_db():
    conn = db_pool.get_connection()
    try:
        yield conn
    finally:
        conn.close()

# ── INIT DB ──────────────────────────────────────────────
def init_db():
    conn = db_pool.get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bills (
            id INT AUTO_INCREMENT PRIMARY KEY,
            local_id VARCHAR(50) UNIQUE,
            customer_name VARCHAR(100),
            customer_mobile VARCHAR(15),
            customer_address TEXT,
            barcode_no VARCHAR(50),
            bill_date DATETIME,
            subtotal DECIMAL(10,2),
            tax_pct DECIMAL(5,2),
            tax_amount DECIMAL(10,2),
            total_discount DECIMAL(10,2) DEFAULT 0,
            old_jewellery_adjustment DECIMAL(10,2) DEFAULT 0,
            grand_total DECIMAL(10,2),
            paid_amount DECIMAL(10,2),
            balance DECIMAL(10,2),
            payment_mode VARCHAR(20),
            remarks TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bill_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bill_id INT,
            name VARCHAR(100),
            barcode VARCHAR(50),
            weight DECIMAL(10,3),
            rate DECIMAL(10,2),
            making DECIMAL(10,2),
            discount DECIMAL(10,2),
            total DECIMAL(10,2),
            FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()

# ── APP LIFESPAN ─────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    print("🚀 Server started successfully")
    yield

app = FastAPI(title="Silver Billing API", lifespan=lifespan)

# ── CORS ────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── MODELS ──────────────────────────────────────────────
class ItemIn(BaseModel):
    name: Optional[str] = "Item"
    weight: Optional[float] = 0
    rate: Optional[float] = 0
    making: Optional[float] = 0
    discount: Optional[float] = 0
    total: Optional[float] = 0

class BillIn(BaseModel):
    local_id: str
    customer_name: Optional[str] = "Unknown"
    customer_mobile: Optional[str] = ""
    customer_address: Optional[str] = ""
    items: List[ItemIn] = []
    subtotal: Optional[float] = 0
    tax_pct: Optional[float] = 0
    tax_amount: Optional[float] = 0
    grand_total: Optional[float] = 0
    paid_amount: Optional[float] = 0
    balance: Optional[float] = 0
    payment_mode: Optional[str] = "Cash"

# ── API ─────────────────────────────────────────────────
@app.get("/")
def home():
    return {"status": "API Running 🚀"}

@app.post("/bills")
def create_bill(bill: BillIn, conn=Depends(get_db)):
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO bills (
                local_id, customer_name, customer_mobile,
                subtotal, tax_pct, tax_amount,
                grand_total, paid_amount, balance, payment_mode
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            bill.local_id,
            bill.customer_name,
            bill.customer_mobile,
            bill.subtotal,
            bill.tax_pct,
            bill.tax_amount,
            bill.grand_total,
            bill.paid_amount,
            bill.balance,
            bill.payment_mode
        ))

        bill_id = cursor.lastrowid

        for item in bill.items:
            cursor.execute("""
                INSERT INTO bill_items (bill_id, name, weight, rate, making, discount, total)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (
                bill_id,
                item.name,
                item.weight,
                item.rate,
                item.making,
                item.discount,
                item.total
            ))

        conn.commit()
        return {"status": "success"}

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()

@app.get("/bills")
def get_bills(conn=Depends(get_db)):
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM bills ORDER BY id DESC")
    data = cursor.fetchall()
    cursor.close()
    return data

# ── RUN ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=not IS_RENDER)