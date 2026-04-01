from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional
import mysql.connector
from mysql.connector import pooling
import os
import json
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import webbrowser
import threading

# ── Configuration ───────────────────────────────────────────────────────────
load_dotenv()

# Handle Render Database URL or individual components
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("MYSQL_URL")
if DATABASE_URL:
    from urllib.parse import urlparse
    u = urlparse(DATABASE_URL)
    DB_CONFIG = {
        "host": u.hostname,
        "port": u.port or 3306,
        "user": u.username,
        "password": u.password,
        "database": u.path.lstrip('/')
    }
else:
    DB_CONFIG = {
        "host": os.getenv("DB_HOST", "localhost"),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "silver_billing_db")
    }

IS_RENDER = os.getenv("RENDER") is not None

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if not IS_RENDER:
        def open_browser():
            print("\n  SILVER BILLING READY! Opening: http://localhost:8000\n")
            webbrowser.open("http://localhost:8000")
        threading.Timer(1.5, open_browser).start()
    yield

app = FastAPI(
    title="Silver Jewellery Billing",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Database Strategy ───────────────────────────────────────────────────────
try:
    db_pool = mysql.connector.pooling.MySQLConnectionPool(
        pool_name="billing_pool",
        pool_size=5,
        **DB_CONFIG
    )
except mysql.connector.Error as err:
    # If DB doesn't exist, create it first
    if err.errno == 1049: # Unknown database
        conn = mysql.connector.connect(
            host=DB_CONFIG["host"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"]
        )
        cursor = conn.cursor()
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_CONFIG['database']}")
        conn.close()
        db_pool = mysql.connector.pooling.MySQLConnectionPool(
            pool_name="billing_pool",
            pool_size=5,
            **DB_CONFIG
        )
    else:
        raise err

def get_db():
    conn = db_pool.get_connection()
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    conn = db_pool.get_connection()
    cursor = conn.cursor()
    
    # 1. Create tables if they don't exist
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
            total_discount DECIMAL(10,2) DEFAULT 0.00,
            old_jewellery_adjustment DECIMAL(10,2) DEFAULT 0.00,
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
            discount DECIMAL(10,2) DEFAULT 0.00,
            total DECIMAL(10,2),
            FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS catalog (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) UNIQUE,
            barcode VARCHAR(50),
            default_rate DECIMAL(10,2),
            making DECIMAL(10,2),
            category VARCHAR(50)
        )
    """)

    # 2. Migrations: Add new columns if missing in existing tables
    # Check bills table
    cursor.execute("SHOW COLUMNS FROM bills LIKE 'barcode_no'")
    if not cursor.fetchone():
        try:
            cursor.execute("ALTER TABLE bills ADD COLUMN barcode_no VARCHAR(50) AFTER customer_address")
            print("[Migration] Added barcode_no column to bills table.")
        except: pass

    cursor.execute("SHOW COLUMNS FROM bills LIKE 'old_jewellery_adjustment'")
    if not cursor.fetchone():
        try:
            cursor.execute("ALTER TABLE bills ADD COLUMN total_discount DECIMAL(10,2) DEFAULT 0.00 AFTER tax_amount")
            cursor.execute("ALTER TABLE bills ADD COLUMN old_jewellery_adjustment DECIMAL(10,2) DEFAULT 0.00 AFTER total_discount")
            print("[Migration] Added Mod and Discount columns to bills table.")
        except: pass

    # Check bill_items table
    cursor.execute("SHOW COLUMNS FROM bill_items LIKE 'discount'")
    if not cursor.fetchone():
        try:
            cursor.execute("ALTER TABLE bill_items ADD COLUMN discount DECIMAL(10,2) DEFAULT 0.00 AFTER making")
            print("[Migration] Added Discount column to bill_items table.")
        except: pass

    conn.commit()
    cursor.close()
    conn.close()

# ── Models ───────────────────────────────────────────────────────────────
class ItemIn(BaseModel):
    name: Optional[str] = "Item"
    item_name: Optional[str] = None
    barcode: Optional[str] = ""
    barcode_no: Optional[str] = None
    weight: Optional[float] = 0.0
    weight_g: Optional[float] = None
    rate: Optional[float] = 0.0
    rate_per_g: Optional[float] = None
    making: Optional[float] = 0.0
    making_charges: Optional[float] = None
    discount: Optional[float] = 0.0
    total: Optional[float] = 0.0
    line_total: Optional[float] = None

class BillIn(BaseModel):
    local_id: str
    id: Optional[str] = None
    customer_name: Optional[str] = "Unknown"
    customer_mobile: Optional[str] = ""
    customer_address: Optional[str] = ""
    barcode_no: Optional[str] = ""
    bill_date: Optional[str] = None
    created_at: Optional[str] = None
    items: List[ItemIn] = []
    subtotal: Optional[float] = 0.0
    tax_pct: Optional[float] = 0.0
    gst_percent: Optional[float] = None
    tax_amount: Optional[float] = 0.0
    gst_amount: Optional[float] = 0.0
    total_discount: Optional[float] = 0.0
    old_jewellery_adjustment: Optional[float] = 0.0
    grand_total: Optional[float] = 0.0
    received_amount: Optional[float] = None
    paid_amount: Optional[float] = None
    balance_due: Optional[float] = None
    balance: Optional[float] = 0.0
    payment_mode: Optional[str] = "Cash"
    remarks: Optional[str] = ""
    notes: Optional[str] = None

class CatalogItem(BaseModel):
    name: str
    barcode: Optional[str] = ""
    default_rate: float
    making: float
    category: Optional[str] = "Silver"

# ── API: Bills ───────────────────────────────────────────────────────────
@app.post("/bills")
@app.post("/bills/")
async def create_bill(bill: BillIn, conn=Depends(get_db)):
    cursor = conn.cursor(dictionary=True)
    try:
        # Check if already exists (sync deduplication)
        cursor.execute("SELECT id FROM bills WHERE local_id = %s", (bill.local_id,))
        if cursor.fetchone():
            return {"status": "skipped", "message": "Bill already synced"}

        # Resolve field differences to support cached frontend PWA updates
        actual_bill_date = bill.bill_date or bill.created_at or datetime.now().isoformat()
        actual_bill_date = actual_bill_date.replace('T', ' ')[:19] # Fix ISO format for MySQL
        
        actual_tax_pct = bill.tax_pct or bill.gst_percent or 0.0
        actual_tax_amt = bill.tax_amount or bill.gst_amount or 0.0
        actual_remarks = bill.remarks or bill.notes or ""
        
        # Financial field mapping
        final_discount = bill.total_discount or 0.0
        final_mod = bill.old_jewellery_adjustment or 0.0
        final_paid = bill.received_amount if bill.received_amount is not None else (bill.paid_amount if bill.paid_amount is not None else bill.grand_total)
        final_balance = bill.balance_due if bill.balance_due is not None else bill.balance

        # Insert Bill
        cursor.execute("""
            INSERT INTO bills (
                local_id, customer_name, customer_mobile, customer_address, 
                barcode_no, bill_date, subtotal, tax_pct, tax_amount, total_discount, 
                old_jewellery_adjustment, grand_total, paid_amount, balance, 
                payment_mode, remarks
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            bill.local_id, bill.customer_name, bill.customer_mobile, bill.customer_address,
            bill.barcode_no, actual_bill_date, bill.subtotal, actual_tax_pct, actual_tax_amt, 
            final_discount, final_mod, bill.grand_total, final_paid, final_balance, 
            bill.payment_mode, actual_remarks
        ))
        
        bill_id = cursor.lastrowid

        # Insert Items
        for item in bill.items:
            actual_name = (item.name if item.name != "Item" else None) or item.item_name or "Item"
            actual_barcode = item.barcode or item.barcode_no or ""
            actual_weight = item.weight or item.weight_g or 0.0
            actual_rate = item.rate or item.rate_per_g or 0.0
            actual_making = item.making or item.making_charges or 0.0
            actual_total = item.total or item.line_total or 0.0

            cursor.execute("""
                INSERT INTO bill_items (bill_id, name, barcode, weight, rate, making, discount, total)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (bill_id, actual_name, actual_barcode, actual_weight, actual_rate, actual_making, item.discount, actual_total))

        conn.commit()
        return {"status": "success", "id": bill_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()

@app.get("/bills")
async def list_bills(conn=Depends(get_db)):
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM bills ORDER BY bill_date DESC")
    bills = cursor.fetchall()
    cursor.close()
    return bills

@app.delete("/bills/{id}")
async def delete_bill(id: str, conn=Depends(get_db)):
    cursor = conn.cursor()
    try:
        # Check if id is numeric (internal DB id) or string (local_id)
        if id.isdigit():
            cursor.execute("DELETE FROM bills WHERE id = %s", (int(id),))
        else:
            cursor.execute("DELETE FROM bills WHERE local_id = %s", (id,))
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()

# ── API: Catalog ────────────────────────────────────────────────────────
@app.get("/items")
async def get_catalog(conn=Depends(get_db)):
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM catalog")
    items = cursor.fetchall()
    cursor.close()
    return items

@app.post("/items")
async def add_to_catalog(item: CatalogItem, conn=Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO catalog (name, barcode, default_rate, making, category)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE 
        barcode=%s, default_rate=%s, making=%s, category=%s
    """, (item.name, item.barcode, item.default_rate, item.making, item.category,
          item.barcode, item.default_rate, item.making, item.category))
    conn.commit()
    cursor.close()
    return {"status": "success"}

# ── API: Reports ────────────────────────────────────────────────────────
@app.get("/dashboard/stats")
async def get_stats(conn=Depends(get_db)):
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT COUNT(*) as totalBills, SUM(grand_total) as totalSales FROM bills")
    stats = cursor.fetchone()
    cursor.close()
    return stats

# ── Static File Serving (Root-Aware for Deployment) ──────────────────────────
# Root directory is now the same folder as main.py
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# Mount assets folders
for folder in ["icons", "css"]:
    f_path = os.path.join(ROOT_DIR, folder)
    if os.path.exists(f_path):
        app.mount(f"/{folder}", StaticFiles(directory=f_path), name=folder)

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(ROOT_DIR, "index.html"))

@app.get("/{filename}")
async def serve_root_files(filename: str):
    # Registry of specific files allowed to be served from root
    allowed = ["app.js", "offline.html", "manifest.json", "service-worker.js"]
    if filename in allowed:
        file_path = os.path.join(ROOT_DIR, filename)
        if os.path.exists(file_path):
            return FileResponse(file_path)
    raise HTTPException(status_code=404)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    # Note: Use reload=False on production/Render
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=not IS_RENDER)
