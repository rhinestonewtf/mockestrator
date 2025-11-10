# ------ Builder Stage ------
FROM oven/bun:1.1.35-alpine AS builder
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./

RUN bun run tsc

# ------ Runner Stage ------
FROM oven/bun:1.1.35-alpine AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY rpcs.json .
COPY config.json .
COPY code.json .

USER bun
EXPOSE 3000

CMD ["node", "dist/app.js"]
