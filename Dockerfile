# 1. Base image
FROM node:20-alpine AS base

# Install libc6-compat for compatibility (needed for some Next.js deps like sharp)
RUN apk add --no-cache libc6-compat
# Enable corepack to use pnpm without installing it manually
RUN corepack enable

# 2. Dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies (frozen-lockfile ensures strict adherence to the lockfile)
RUN pnpm i --frozen-lockfile

# 3. Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_S3_ENDPOINT
ARG NEXT_PUBLIC_INSTANT_API_URI
ARG NEXT_PUBLIC_INSTANT_WEBSOCKET_URI
ARG NEXT_PUBLIC_INSTANT_APP_ID

# Build the application
# Note: If your project uses environment variables during build, 
# you might need to ARG/ENV them here or build will fail.
RUN pnpm run build

# 4. Runner stage (Production)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy the standalone build artifacts
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
# "server.js" is the entry point created by output: 'standalone'
CMD ["node", "server.js"]
