#!/bin/bash

echo "🚀 Starting Hedera Trading Wallet Agent..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

API_PORT="${PORT:-3001}"
BACKEND_PID=""

if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null; then
    echo "✅ Backend API is already running on port $API_PORT."
  else
    echo "❌ Backend API port $API_PORT is already in use by another process."
    echo "The process using it is:"
    lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN
    echo ""
    echo "Stop that process first, then run ./start.sh again."
    exit 1
  fi
else
  # Start the Backend API in the background
  echo "⚡ Starting Backend API (Port $API_PORT)..."
  npm run dev &
  BACKEND_PID=$!

  # Wait a couple of seconds to let backend start up
  sleep 2

  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo "❌ Backend API failed to start."
    wait "$BACKEND_PID"
    exit 1
  fi

  if ! curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null; then
    echo "❌ Backend API did not pass the health check on port $API_PORT."
    kill "$BACKEND_PID" >/dev/null 2>&1
    wait "$BACKEND_PID" >/dev/null 2>&1
    exit 1
  fi
fi

# Start the Frontend UI in the background
echo "🌐 Starting Frontend UI (Port 5173)..."
npm run web:dev &
FRONTEND_PID=$!

sleep 1

if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
  echo "❌ Frontend UI failed to start."
  wait "$FRONTEND_PID"
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1
  fi
  exit 1
fi

echo "✅ All services started!"
echo "➡️  Frontend accessible at: http://localhost:5173"
echo "➡️  Backend accessible at: http://localhost:$API_PORT"
echo "Press Ctrl+C to stop all services."

shutdown() {
  echo -e "\n🛑 Shutting down services..."
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1
  fi
  kill "$FRONTEND_PID" >/dev/null 2>&1
  exit 0
}

# Trap Ctrl+C (SIGINT) and kill background processes started by this script
trap shutdown SIGINT SIGTERM

# Wait indefinitely until interrupted
wait
