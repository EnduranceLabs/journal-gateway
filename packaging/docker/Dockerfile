FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY gateway/package.json ./gateway/package.json
RUN cd gateway && pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/gateway/node_modules ./gateway/node_modules
COPY . .
RUN cd gateway && pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/gateway/node_modules ./gateway/node_modules
COPY --from=builder /app/gateway/dist ./gateway/dist
COPY gateway/package.json ./gateway/package.json

CMD ["node", "gateway/dist/main.js"]
