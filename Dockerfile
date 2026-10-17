FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY terminal/package.json terminal/package.json
RUN pnpm install --frozen-lockfile --filter frequi-terminal...

COPY terminal terminal
RUN pnpm --filter frequi-terminal build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV BOTS_FILE=/config/bots.local.json

COPY --from=build --chown=node:node /app/terminal/dist ./dist
COPY --from=build --chown=node:node /app/terminal/server ./server

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "server/prod.ts"]
