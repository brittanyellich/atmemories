# Use official Node.js LTS image
FROM node:20

# Set working directory
WORKDIR /

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose port (change if your app uses a different port)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]