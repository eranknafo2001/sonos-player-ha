FROM oven/bun:1-alpine

RUN apk add --no-cache jq

WORKDIR /app
COPY workspace/package.json workspace/tsconfig.json ./
COPY workspace/packages ./packages
COPY rootfs/run.sh /run.sh

RUN bun install
RUN chmod +x /run.sh

CMD ["/run.sh"]
