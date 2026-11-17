# Enhanced derivative of Alexa Griffith's MIT-licensed markmyword.
FROM oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=development HOST=0.0.0.0 PORT=3939 HS_DB_PATH=/data/app.db HS_DOCS_DIR=/data/docs
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock *.js LICENSE ./
COPY --chown=bun:bun bin ./bin
COPY --chown=bun:bun lib ./lib
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun scripts/docker-start.mjs scripts/backup.mjs scripts/restore.mjs ./scripts/
COPY --chown=bun:bun docs/example.html ./docs/example.html
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 3939
CMD ["bun", "scripts/docker-start.mjs"]
