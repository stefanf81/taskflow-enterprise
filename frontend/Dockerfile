# Stage 1: Build Stage
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependency configs and install them
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy application source code and compile
COPY . .
RUN npm run build

# Stage 2: Production Nginx Runtime Stage (Security Hardened Non-Root)
FROM nginxinc/nginx-unprivileged:alpine

# Copy static assets from the builder stage (specifically the browser sub-directory)
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# Copy our custom Nginx server block configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP unprivileged port 8080
EXPOSE 8080

# Run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
