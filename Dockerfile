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

# Start server
CMD uvicorn backend.server:app --host 0.0.0.0 --port ${PORT:-8000}
