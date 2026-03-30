import urllib.request
import json
import uuid
import datetime

url = "http://localhost:8000/bills"

# Construct payload
payload = {
    "local_id": str(uuid.uuid4()),
    "customer_name": "Test User",
    "customer_mobile": "1234567890",
    "customer_address": "Test Address",
    "bill_date": datetime.datetime.now().isoformat(),
    "items": [
        {
            "name": "Silver Ring",
            "barcode": "123",
            "weight": 10.5,
            "rate": 80.0,
            "making": 100.0,
            "total": 940.0
        }
    ],
    "subtotal": 940.0,
    "tax_pct": 3.0,
    "tax_amount": 28.2,
    "discount": 0.0,
    "grand_total": 968.2,
    "paid_amount": 968.2,
    "balance": 0.0,
    "payment_mode": "Cash",
    "remarks": "API Test"
}

data = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")

try:
    with urllib.request.urlopen(req) as response:
        print("Status:", response.status)
        print("Response:", response.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code)
    print("Error details:", e.read().decode())
except Exception as e:
    print("Error:", str(e))
