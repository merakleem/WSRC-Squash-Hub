FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Build tools for the better-sqlite3 native addon (used only if no prebuilt
# binary matches this Node); setpriv is what drops root at start-up.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ util-linux \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8080

# Docker's own liveness probe. Railway uses its healthcheck path setting
# (/health) instead, but anyone running the image elsewhere gets this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Starts as root only long enough to hand the data volume to the app user,
# then runs the server as that user. See docker-entrypoint.sh.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
