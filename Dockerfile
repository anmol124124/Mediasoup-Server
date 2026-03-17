FROM node:20-slim

# mediasoup compiles native C++ bindings via node-gyp.
# python3, make, g++, pkg-config are all required at build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy lockfile alongside package.json so npm ci produces a reproducible,
# byte-for-byte identical install on every build.
# If package-lock.json does not yet exist, run `npm install` locally first
# to generate it, then commit it to the repository.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3000

# RTP/RTCP UDP ports — must match RTC_MIN_PORT/RTC_MAX_PORT in .env
# and the port mapping in docker-compose.yml.
EXPOSE 40000-40100/udp

CMD ["node", "src/index.js"]
