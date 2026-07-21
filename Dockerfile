FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

# Install python3, build-base, git, curl, and bash
RUN apk add --no-cache python3 py3-pip git curl bash build-base

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
ENV RADAR__ML_PYTHON="/app/.venv-ml/bin/python"
RUN uv venv --python 3.12 /app/.venv-ml && \
    uv pip install --requirement ml/requirements.txt --python /app/.venv-ml

EXPOSE 8080

ENV PORT=8080
ENV RADAR__DAEMON_PORT=8080

CMD ["node", "dist/server.js"]
