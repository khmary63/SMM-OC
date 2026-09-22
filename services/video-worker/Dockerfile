FROM node:22-slim

# fonts-dejavu-core — шрифт заголовка на кадре; без него drawtext падает.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js .

EXPOSE 8082
CMD ["node", "server.js"]
