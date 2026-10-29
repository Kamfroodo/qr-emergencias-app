FROM node:24-alpine AS dashboard-build

WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY public ./public
RUN npm run build:dashboard

FROM node:24-alpine AS production

LABEL maintainer="Dashboard Emergencias"
LABEL description="Aplicación de fichas médicas de emergencia y códigos QR"

WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node app.js auth.js db.js openapi.js server.js ./
COPY --chown=node:node public ./public
COPY --from=dashboard-build --chown=node:node /usr/src/app/public/js/dashboard.bundle.js ./public/js/dashboard.bundle.js

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
