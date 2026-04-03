FROM oven/bun:1-alpine

RUN apk add --no-cache jq

WORKDIR /app
COPY bun.lock package.json tsconfig.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile --production

COPY packages/ha-addon/rootfs/run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
