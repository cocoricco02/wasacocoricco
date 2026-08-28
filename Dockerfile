FROM node:20

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

ENV PORT=3005
ENV NODE_ENV=production

EXPOSE 3005

CMD ["node", "server.js"]
