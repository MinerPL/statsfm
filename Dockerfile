FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npx prisma generate

RUN npm run build

RUN rm config.json

FROM node:24-alpine AS runner

WORKDIR /app

COPY --from=builder /app .

CMD ["npm", "start"]
