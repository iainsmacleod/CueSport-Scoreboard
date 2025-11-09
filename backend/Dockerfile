FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application files
COPY server.js ./
COPY db.js ./
COPY logger.js ./
COPY auth.js ./
COPY public/ ./public/

# Create data and logs directories
RUN mkdir -p /app/data /app/logs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/streams.db

# Run the application
CMD ["node", "server.js"]

