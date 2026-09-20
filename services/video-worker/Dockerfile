FROM node:22-slim

# fonts-dejavu-core обязателен: drawtext рендерит заголовок рилса этим шрифтом,
# в node:22-slim шрифтов нет вообще.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js reel.js ./

EXPOSE 8082
CMD ["node", "server.js"]
