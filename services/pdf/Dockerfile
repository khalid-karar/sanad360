# Sanad 360 PDF service — production image (launch-critical item 3)
#
# Node 22 base is REQUIRED: @supabase/realtime-js needs native WebSocket
# (Node >= 22); on Node 20 the service crashes at startup — this is exactly
# what broke the first cloud CI runs. Chromium + its system deps are
# installed via the version-matched playwright package from package.json,
# so PDFs render identically to local dev (Arabic fonts included via --with-deps).
#
# Build (from services/pdf/):   docker build -t sanad360-pdf .
# Run:                          see docker-compose.yml (restart policy = the supervisor)
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Chromium + OS-level rendering deps (fonts, GTK libs) for the pinned
# playwright version.
RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production \
    PORT=3001

# The queue holds at most 2 concurrent Chromium renders; 1GB is comfortable.
EXPOSE 3001

# Container-level liveness: the same /health the CD smoke step and the
# uptime workflow probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# PID 1 gets SIGTERM from docker stop; index.ts drains in-flight renders.
CMD ["node", "dist/index.js"]
