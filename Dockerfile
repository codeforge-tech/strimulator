FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun install --production --frozen-lockfile

FROM oven/bun:alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

ENV STRIMULATOR_PORT=12111
ENV STRIMULATOR_DB_PATH=/data/strimulator.db
VOLUME /data
EXPOSE 12111

CMD ["bun", "run", "src/index.ts"]
