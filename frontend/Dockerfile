# Production Nginx Runtime Stage (Security Hardened Non-Root)
FROM nginxinc/nginx-unprivileged:alpine

# Copy static assets from the pre-built dist directory on host
COPY dist/frontend/browser /usr/share/nginx/html

# Copy our custom Nginx server block configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP unprivileged port 8080
EXPOSE 8080

# Run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
