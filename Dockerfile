# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: the "prepare" hook runs `npm run build`, but src isn't
# present yet at install time. We build explicitly after copying src.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=3000 \
    QBO_DATA_DIR=/app/data

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist

# Per-company token store lives on a volume; run as a non-root user.
RUN mkdir -p /app/data \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app
USER app

EXPOSE 3000
CMD ["node", "dist/index.js"]
