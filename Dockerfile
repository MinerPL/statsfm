FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update -y \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./tsconfig.json

RUN npx prisma generate --schema /app/prisma/schema.prisma
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma generate --schema /app/prisma/schema.prisma && npx prisma migrate deploy --schema /app/prisma/schema.prisma && node dist/server.js"]
