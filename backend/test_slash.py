import urllib.request
import json
import uuid
import datetime

url = "http://localhost:8000/bills/"  # <-- with trailing slash!

payload = {
    "local_id": str(uuid.uuid4()),
    "customer_name": "Trailing Slash Test",
    "customer_mobile": "",
    "customer_address": "",
    "bill_date": datetime.datetime.now().isoformat(),
    "items": [],
    "subtotal": 0.0,
    "tax_pct": 0.0,
    "tax_amount": 0.0,
    "discount": 0.0,
    "grand_total": 0.0,
    "paid_amount": 0.0,
    "balance": 0.0,
    "payment_mode": "Cash",
    "remarks": ""
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
