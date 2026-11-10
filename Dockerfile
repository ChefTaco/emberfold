ARG RUNTIME_IMAGE=ghcr.io/cheftaco/hive-node-runtime:26.13.0-1@sha256:48948514bce59a27f8ee2a3eabaea0a04cbfa87e087297a52f8501c0d465c84f
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime-dependencies
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${RUNTIME_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-dependencies /app /app
USER node
EXPOSE 8096
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8096/healthz').then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/cli/dist/index.js", "serve", "--config", "/config/service.json"]
