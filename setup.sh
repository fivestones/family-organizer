#!/bin/bash

# Default App ID for self-hosting (can be anything UUID-like)
APP_ID="70000000-0000-0000-0000-000000000000"
USER_EMAIL="admin@local.com"

# Check if .env already exists
if [ -f .env ]; then
  echo "✅ .env file found. Loading configuration..."
else
  echo "📝 No .env file found. Generating new secure configuration..."
  
  # Generate secure secrets
  DEVICE_KEY=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  SESSION_SECRET=$(openssl rand -hex 32)
  MINIO_USER="minioadmin"
  MINIO_PASS=$(openssl rand -hex 12)

  cat > .env <<EOF
# --- Public Config ---
NEXT_PUBLIC_INSTANT_APP_ID=$APP_ID
NEXT_PUBLIC_S3_ENDPOINT=http://localhost:9000
NEXT_PUBLIC_INSTANT_API_URI=http://localhost:8888
NEXT_PUBLIC_INSTANT_WEBSOCKET_URI=ws://localhost:8888/runtime/session

# --- Secrets (Do Not Commit) ---
DEVICE_ACCESS_KEY="$DEVICE_KEY"
S3_ACCESS_KEY_ID="$MINIO_USER"
S3_SECRET_ACCESS_KEY="$MINIO_PASS"
INSTANT_JWT_SECRET="$JWT_SECRET"
INSTANT_SESSION_SECRET="$SESSION_SECRET"
INSTANT_DB_PASSWORD="instant_password"
EOF
  
  echo "🔑 Secrets generated in .env"
  echo "⚠️  NOTE YOUR DEVICE ACCESS KEY: $DEVICE_KEY"
fi

# Load env vars for this script context
export $(grep -v '^#' .env | xargs)

# 1. Start Infrastructure
echo "🚀 Starting Infrastructure..."
docker-compose up -d minio instant-postgres instant-server

echo "⏳ Waiting for InstantDB Server to be ready..."
until curl -s http://localhost:8888 > /dev/null; do
  sleep 5
  echo "   Still waiting..."
done
echo "✅ InstantDB Server is UP!"

# 2. Inject App ID directly into Postgres
# This bypasses the need for CLI login/auth codes
echo "💉 Injecting App Configuration..."

docker exec -i instant-postgres psql -U instant -d instant <<EOF
-- Create User
INSERT INTO instant_users (id, email, created_at)
VALUES (gen_random_uuid(), '$USER_EMAIL', now())
ON CONFLICT (email) DO NOTHING;

-- Create App
INSERT INTO apps (id, title, creator_id, created_at)
VALUES ('$APP_ID', 'Family Organizer', (SELECT id FROM instant_users WHERE email = '$USER_EMAIL'), now())
ON CONFLICT (id) DO NOTHING;
EOF

# 3. Start the App
echo "🚀 Starting Family App..."
docker-compose up -d family-app --build

echo "🎉 DEPLOYMENT COMPLETE!"
echo "---------------------------------------------------"
echo "📱 App URL:        http://localhost:3000"
echo "🔐 Magic Link:     http://localhost:3000/?activate=$DEVICE_ACCESS_KEY"
echo "🗄️  MinIO Console:  http://localhost:9001 ($S3_ACCESS_KEY_ID / $S3_SECRET_ACCESS_KEY)"
echo "---------------------------------------------------"