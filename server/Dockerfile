# Runs backend — REST + WebSocket, SQLite, invite-code auth.
# Build:  docker build -t runs-server .
# Run:    docker run -p 4000:4000 -v ./data:/app/data -e INVITE_CODES=RUNS-XXXX runs-server

# ---- build stage: compile TypeScript ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npm run build

# ---- runtime stage: production deps + compiled output ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# SQLite lives here; mount a volume to persist it.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME /app/data

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
