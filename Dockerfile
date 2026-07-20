FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Install dependencies, git, curl, and python build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install uv using the official installer
ADD https://astral.sh/uv/install.sh /uv-bootstrap.sh
RUN sh /uv-bootstrap.sh && rm /uv-bootstrap.sh
ENV PATH="/root/.local/bin:${PATH}"

# Copy build output, node_modules and dependencies
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY scripts/ ./scripts/
COPY plugin.yaml ./
COPY ml/ ./ml/

# Create virtualenv and install dependencies
ENV RADAR__ML_PYTHON="/app/.venv-ml/bin/python3"
RUN uv venv --python 3.14 /app/.venv-ml && \
    uv pip install --requirement ml/requirements.txt --python /app/.venv-ml

EXPOSE 9877

ENV RADAR__DAEMON_PORT=9877

CMD ["node", "dist/cli.js", "daemon"]
