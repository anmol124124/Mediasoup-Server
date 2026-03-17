FROM node:20-slim

# mediasoup compiles native C++ bindings via node-gyp — these packages are required
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cache friendly)
COPY package.json ./
RUN npm install

COPY src ./src

EXPOSE 3000

# RTP/RTCP UDP ports — must match config.worker.rtcMinPort/rtcMaxPort
# and the range exposed in docker-compose.yml
EXPOSE 40000-40100/udp

CMD ["node", "src/index.js"]
