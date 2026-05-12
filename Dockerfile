# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini openssl ca-certificates \
    && addgroup -g 1001 -S nodejs \
    && adduser -S app -u 1001 -G nodejs
ENV NODE_ENV=production
COPY --from=builder --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/dist ./dist
COPY --from=builder --chown=app:nodejs /app/prisma ./prisma
COPY --from=builder --chown=app:nodejs /app/package.json ./package.json
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
