FROM python:3.13-slim-bookworm AS backend
WORKDIR /app/backend
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home app && mkdir -p /app/uploads /app/logs && chown app:app /app/uploads /app/logs
COPY backend/src ./src
ENV PYTHONPATH=/app/backend/src PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", "/api", "--no-access-log"]

FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV REACT_APP_API_BASE_URL=/api REACT_APP_MAX_UPLOAD_SIZE_MB=100 GENERATE_SOURCEMAP=false
RUN npm run build

FROM nginx:stable-alpine AS frontend
COPY --from=frontend-build /app/build /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
