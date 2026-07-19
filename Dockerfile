FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY scripts/ ./scripts/
COPY plugin.yaml ./

EXPOSE 9877

ENV RADAR__DAEMON_PORT=9877

CMD ["node", "dist/cli.js", "daemon"]
