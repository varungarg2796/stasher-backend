# ---- 1. Base Stage: Defines the environment ----
FROM node:22-slim AS base
WORKDIR /app
# Install OpenSSL and other required packages
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
# Install the specific pnpm version you use locally
RUN npm install -g pnpm@9.4.0 # <-- IMPORTANT: Set your version here

# ---- 2. Dependencies Stage: Installs ALL dependencies ----
FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
# Install all dependencies including devDependencies needed for building
RUN pnpm install --frozen-lockfile --prod=false

# ---- 3. Build Stage: Compiles the application ----
FROM base AS build
COPY . .
COPY --from=dependencies /app/node_modules ./node_modules
# First, generate prisma client to be available for the build process
RUN pnpm exec prisma generate
# Then, build the application
RUN pnpm run build

# ---- 4. Production Stage: Creates the final, small image ----
FROM base AS production
ENV NODE_ENV=production
# Copy package files and install ONLY production dependencies.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=true
# Copy the compiled code from the 'build' stage
COPY --from=build /app/dist ./dist
# Copy the prisma schema needed at runtime
COPY --from=build /app/prisma ./prisma

# --- THE FIX IS HERE ---
# Generate the Prisma Client again, this time for the production node_modules.
# This ensures the generated client code is present for the running app.
RUN npx prisma generate

EXPOSE 3000
# Updated CMD to use pnpm, which is more consistent with the rest of the file
CMD ["pnpm", "run", "start:prod"]