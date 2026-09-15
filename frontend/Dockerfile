# Dev image: vite dev server with HMR. A production build would run
# `npm run build` and serve ./dist; kept simple while exploring the chart.
FROM node:22-alpine

ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app

COPY package.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm install --no-audit --no-fund

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
