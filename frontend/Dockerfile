FROM node:20-alpine

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend .
EXPOSE 4173
CMD ["npm", "run", "dev"]
