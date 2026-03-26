FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git unzip curl openssh-client pipx && rm -rf /var/lib/apt/lists/* && \
    pipx install ansible-core && \
    ln -s /root/.local/bin/ansible-playbook /usr/local/bin/ansible-playbook && \
    ln -s /root/.local/bin/ansible /usr/local/bin/ansible && \
    ln -s /root/.local/bin/ansible-galaxy /usr/local/bin/ansible-galaxy && \
    ansible-galaxy collection install ansible.posix

# Install Terraform (direct binary download)
ARG TERRAFORM_VERSION=1.9.8
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${ARCH}.zip" -o /tmp/terraform.zip && \
    unzip /tmp/terraform.zip -d /usr/local/bin/ && \
    rm /tmp/terraform.zip && \
    terraform version

WORKDIR /app

# Install dependencies (cached separately from app code)
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev 2>/dev/null || uv sync --no-dev

# Copy application code
COPY app/ ./app/

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
