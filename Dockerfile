FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# The service runs only node; package managers and apt are not used at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && dpkg --purge --force-remove-protected --force-remove-essential apt libapt-pkg6.0 \
 && rm -rf /etc/apt /var/lib/apt /var/cache/apt /var/log/apt /root/.npm
USER node
EXPOSE 8096
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8096/healthz').then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/cli/dist/index.js", "serve", "--config", "/config/service.json"]
