# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
# No BASE_PATH: the container serves the site from the domain root, unlike the
# GitHub Pages project page which is served from /retroheat/.
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
