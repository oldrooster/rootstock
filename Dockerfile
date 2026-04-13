# Stage 1: Build React frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend with embedded frontend
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git unzip curl openssh-client pipx \
    && rm -rf /var/lib/apt/lists/* \
    && pipx install ansible-core \
    && ln -s /root/.local/bin/ansible-playbook /usr/local/bin/ansible-playbook \
    && ln -s /root/.local/bin/ansible /usr/local/bin/ansible \
    && ln -s /root/.local/bin/ansible-galaxy /usr/local/bin/ansible-galaxy \
    && ansible-galaxy collection install ansible.posix

ARG TERRAFORM_VERSION=1.9.8
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${ARCH}.zip" -o /tmp/terraform.zip && \
    unzip /tmp/terraform.zip -d /usr/local/bin/ && \
    rm /tmp/terraform.zip && \
    terraform version

WORKDIR /app

# Install Python dependencies (cached layer)
COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv sync --frozen --no-dev 2>/dev/null || uv sync --no-dev

# Copy application code and built frontend
COPY backend/app/ ./app/
COPY --from=frontend-builder /frontend/dist ./static/

EXPOSE 8000

CMD ["uv", "run", "gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--timeout", "120"]
