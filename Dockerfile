# Stage 1: Install production dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Production runtime
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
USER appuser

COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup src ./src

ENV NODE_ENV=production
ENV PORT=8080
ENV CONTAINER_MODE=true

EXPOSE 8080

CMD ["node", "src/index.js"]
