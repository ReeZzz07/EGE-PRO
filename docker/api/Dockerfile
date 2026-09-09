FROM node:20-slim
WORKDIR /app
# gosu — переключение на непривилегированного пользователя ПОСЛЕ старта контейнера (см.
# docker-entrypoint.sh), а не через `USER` здесь напрямую: STORAGE_ROOT — смонтированный volume
# (storage_data, см. docker-compose.yml), которым на момент сборки образа ещё не существует, и
# его фактического владельца на хосте мы не контролируем — entrypoint должен сам chown'уть его
# под node при каждом старте, для чего первую секунду жизни контейнера нужен root.
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN chmod +x docker-entrypoint.sh
EXPOSE 8787
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
