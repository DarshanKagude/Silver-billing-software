# Backend - Silver Jewellery Billing

This directory contains the FastAPI backend for the Silver Jewellery Billing system.

## Setup Instructions

1. **Python Version**: Ensure you have Python 3.8+ installed.
2. **Virtual Environment**:
   ```bash
   python -m venv .venv
   ```
3. **Activation**:
   - Windows: `.venv\Scripts\activate`
   - Linux/Mac: `source .venv/bin/activate`
4. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
5. **Configuration**:
   Copy `.env.example` to `.env` and fill in your MySQL credentials.
   ```bash
   cp .env.example .env
   ```
6. **Run Server**:
   ```bash
   python main.py
   ```

## API Endpoints

- `GET /bills`: List all bills.
- `POST /bills`: Create a new bill (and sync from PWA).
- `GET /items`: Get inventory catalog.
- `GET /dashboard/stats`: Get sales summary.

## Testing

Run the included test scripts to verify the API:
```bash
python test_api.py
python test_slash.py
```
