# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .
RUN npm run build

# Copy ffmpeg.wasm core files into dist
RUN mkdir -p dist/ffmpeg && \
    cp node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js dist/ffmpeg/ && \
    cp node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm dist/ffmpeg/ && \
    cp node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js dist/ffmpeg/

# Serve stage
FROM nginx:alpine

RUN apk add --no-cache tzdata

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
