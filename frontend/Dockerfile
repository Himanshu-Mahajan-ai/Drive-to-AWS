FROM node:20-alpine AS builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

RUN npm install -g serve

EXPOSE 4173

# Use serve to host the built static files
CMD ["serve", "-s", "dist", "-l", "4173"]
