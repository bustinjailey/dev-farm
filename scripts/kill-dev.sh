#!/bin/bash
# Kill any running dev-farm dashboard instances

echo "Checking for running dashboard processes..."

# Find and kill node/tsx processes running on port 5000
PIDS=$(lsof -ti:5000 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Found processes on port 5000: $PIDS"
  echo "Killing processes..."
  kill -9 $PIDS 2>/dev/null
  echo "Killed processes on port 5000"
else
  echo "No processes found on port 5000"
fi

# Also check for vite dev server on 5173
VITE_PIDS=$(lsof -ti:5173 2>/dev/null)
if [ -n "$VITE_PIDS" ]; then
  echo "Found Vite processes on port 5173: $VITE_PIDS"
  echo "Killing processes..."
  kill -9 $VITE_PIDS 2>/dev/null
  echo "Killed processes on port 5173"
else
  echo "No processes found on port 5173"
fi

echo "Done! You can now run 'pnpm dev'"
