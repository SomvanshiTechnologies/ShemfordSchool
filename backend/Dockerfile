FROM python:3.11-slim

WORKDIR /app

# Install system deps needed by some packages (reportlab, bcrypt, etc.).
# fonts-dejavu-core carries the Unicode glyphs ReportLab needs for the rupee
# sign — python:3.11-slim ships no TTF at all, so without it fees.py falls back
# to core Helvetica and every receipt prints "Rs." instead of "₹".
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Non-root user for security
# uploads/ is dockerignored, so create it here: a fresh named volume mounted at /app/uploads
# inherits this ownership, otherwise it is root-owned and the app cannot write voice notes/files.
RUN adduser --disabled-password --gecos "" appuser && mkdir -p /app/uploads && chown -R appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
