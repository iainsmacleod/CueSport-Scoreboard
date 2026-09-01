FROM node:22-bookworm-slim

# better-sqlite3 native build + healthcheck
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY backend/web ./web
COPY backend/supabase ./supabase
COPY common/images ./common/images
COPY common/images ./web/images/balls

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SQLITE_PATH=/app/data/cuesport.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/index.js"]
