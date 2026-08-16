# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build-time config: React only reads REACT_APP_* vars when `npm run build`
# runs (they get baked into the static JS bundle). Runtime env vars in the
# nginx container below do nothing for CRA/Vite static builds.
# Add one ARG + ENV pair per variable your app needs.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# --- Serve stage ---
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
# ^ change /app/build to /app/dist if you're using Vite instead of CRA

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
