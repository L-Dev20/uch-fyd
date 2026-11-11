FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 4100 4101 4102 4103
CMD ["npm", "run", "gateway"]
