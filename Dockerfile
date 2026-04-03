FROM node:22-slim

WORKDIR /app

# Build tools needed to compile better-sqlite3 native addon
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["node", "server.js"]
