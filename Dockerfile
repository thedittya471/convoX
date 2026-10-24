ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.28.6
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY . .

FROM dependencies AS server
RUN pnpm exec turbo run build --filter=@convox/server...
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]

FROM dependencies AS web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec turbo run build --filter=@convox/web...
RUN chown -R node:node apps/web/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@convox/web", "exec", "next", "start", "--hostname", "0.0.0.0"]
