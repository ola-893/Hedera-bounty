#!/bin/bash

echo "🚀 Starting Hedera Trading Wallet Agent..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Start the Backend API in the background
echo "⚡ Starting Backend API (Port 3001)..."
npm run dev &
BACKEND_PID=$!

# Wait a couple of seconds to let backend start up
sleep 2

# Start the Frontend UI in the background
echo "🌐 Starting Frontend UI (Port 5173)..."
npm run web:dev &
FRONTEND_PID=$!

echo "✅ All services started!"
echo "➡️  Frontend accessible at: http://localhost:5173"
echo "➡️  Backend accessible at: http://localhost:3001"
echo "Press Ctrl+C to stop all services."

# Trap Ctrl+C (SIGINT) and kill background processes
trap "echo -e '\n🛑 Shutting down services...'; kill $BACKEND_PID $FRONTEND_PID; exit 0" SIGINT SIGTERM

# Wait indefinitely until interrupted
wait
