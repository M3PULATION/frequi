FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY terminal/package.json terminal/package.json
RUN pnpm install --frozen-lockfile --filter frequi-terminal...

COPY terminal terminal
RUN pnpm --filter frequi-terminal build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
ENV BOTS_FILE=/config/bots.local.json

COPY --from=build /app/terminal/dist ./dist
COPY --from=build /app/terminal/server ./server

EXPOSE 80
CMD ["node", "--experimental-strip-types", "server/prod.ts"]
