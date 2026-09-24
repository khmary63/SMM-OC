FROM node:22-slim

# fonts-dejavu-core — шрифт для заголовка поверх кадра: ffmpeg тянет
# fontconfig, но ни одного шрифта в node:22-slim нет, и drawtext падает.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js .

EXPOSE 8082
CMD ["node", "server.js"]
