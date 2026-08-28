FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --legacy-peer-deps

COPY . .

ENV PORT=3005
ENV NODE_ENV=production

EXPOSE 3005

CMD ["node", "server.js"]
