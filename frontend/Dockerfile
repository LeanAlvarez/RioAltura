# Build context: frontend/. See docker-compose.yml.
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Empty VITE_API_URL = same origin under /api (proxied by nginx below).
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

FROM nginx:1.27-alpine
ENV API_UPSTREAM=api:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
