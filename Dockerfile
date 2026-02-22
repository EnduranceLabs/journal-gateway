FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/types/package.json ./packages/types/package.json
COPY packages/gateway/package.json ./packages/gateway/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/gateway/node_modules ./packages/gateway/node_modules
COPY --from=deps /app/packages/mcp/node_modules ./packages/mcp/node_modules
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/gateway/node_modules ./packages/gateway/node_modules
COPY --from=deps /app/packages/mcp/node_modules ./packages/mcp/node_modules
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist
COPY packages/types/package.json ./packages/types/package.json
COPY packages/gateway/package.json ./packages/gateway/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY package.json pnpm-workspace.yaml ./

CMD ["node", "packages/mcp/dist/main.js"]
