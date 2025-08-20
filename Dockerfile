# Use Node.js 18 LTS with Debian base
FROM node:18-bullseye

# Install Chrome secondo la documentazione OpenWA
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (OpenWA gestirà Chromium tramite browserRevision)
RUN npm ci --only=production

# Copy application code
COPY . .

# Create session data directory and temporary directories for node-persist
RUN mkdir -p /app/wa-sessions && chown -R node:node /app/wa-sessions
RUN mkdir -p /tmp/wa-storage /tmp/wa-storage/node-persist /tmp/wa-storage/sessions
RUN chmod -R 777 /tmp/wa-storage
RUN chown -R node:node /tmp/wa-storage

# Create uploads directory in tmp for CSV uploads (production)
RUN mkdir -p /tmp/uploads
RUN chmod -R 777 /tmp/uploads
RUN chown -R node:node /tmp/uploads

# Set environment variables for OpenWA
ENV NODE_ENV=production
ENV OPENWA_HEADLESS=true
ENV OPENWA_SESSION_DATA_PATH=/tmp/wa-storage
ENV OPENWA_STORAGE_PATH=/tmp/wa-storage
# Non impostare CHROME_PATH per permettere auto-detection

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"] 