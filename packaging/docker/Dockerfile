FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@journal.one/gateway-protocol --filter=@journal.one/gateway build
RUN pnpm --filter=@journal.one/gateway deploy --prod --legacy /prod/gateway

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/gateway ./
CMD ["node", "dist/main.js"]
