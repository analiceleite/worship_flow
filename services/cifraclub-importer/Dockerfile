FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=3010

EXPOSE 3010

CMD ["npm", "start"]
