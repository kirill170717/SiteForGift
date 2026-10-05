FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY email-template.js gift-crypto.js delivery-client.js ./
ENV GIFT_SERVER_HOST=0.0.0.0
ENV GIFT_SERVER_PORT=8787
ENV GIFT_DATA_DIR=/data/deliveries
USER node
EXPOSE 8787
CMD ["node", "server/app.js"]
