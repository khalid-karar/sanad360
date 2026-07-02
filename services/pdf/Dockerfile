# Sanad 360 PDF service — production image (launch-critical item 3)
#
# Base: Playwright's official image, version-matched to package.json
# ("playwright": "^1.44.0") — ships Chromium + all Arabic font/rendering
# system deps, so PDFs render identically to local dev.
#
# Build (from services/pdf/):   docker build -t sanad360-pdf .
# Run:                          see docker-compose.yml (restart policy = the supervisor)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

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
