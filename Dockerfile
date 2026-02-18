FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project
COPY . .

# Create needed directories
RUN mkdir -p uploads data

# Expose port
EXPOSE 8000

# Auto-seed demo data on every deploy (Railway has ephemeral filesystem)
ENV SEED_DEMO=true

# Run migrations then start server
CMD ["sh", "-c", "alembic upgrade head 2>/dev/null; python3 backend/server.py"]
