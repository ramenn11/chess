#!/usr/bin/env bash
# Chess Platform - Master Startup Script (uv-based)
# Runs: Daphne (Main + Actors) + Bot Django

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Paths
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
BOT_DIR="$PROJECT_ROOT/chess_bot"
LOG_DIR="$PROJECT_ROOT/logs"

# Ports
MAIN_SERVER_PORT=8000
BOT_SERVER_PORT=8001

# Logs
mkdir -p "$LOG_DIR"

MAIN_SERVER_LOG="$LOG_DIR/main_server.log"
BOT_SERVER_LOG="$LOG_DIR/bot_server.log"

# PIDs
MAIN_SERVER_PID="$LOG_DIR/main_server.pid"
BOT_SERVER_PID="$LOG_DIR/bot_server.pid"

# Cleanup
cleanup() {
    # Prevent the trap from firing twice
    trap - SIGINT SIGTERM EXIT
    
    echo -e "${YELLOW}Shutting down services...${NC}"

    # 1. Kill the tracked processes AND their children
    for pidfile in "$MAIN_SERVER_PID" "$BOT_SERVER_PID"; do
        if [ -f "$pidfile" ]; then
            PID=$(cat "$pidfile")
            # Kill child processes (Daphne/Django) of the uv wrapper
            pkill -P "$PID" 2>/dev/null || true
            # Kill the uv wrapper itself
            kill "$PID" 2>/dev/null || true
            rm -f "$pidfile"
        fi
    done

    # 2. Failsafe: Forcefully free the specific ports if anything survived (e.g., auto-reloaders)
    echo -e "${YELLOW}Freeing ports $MAIN_SERVER_PORT and $BOT_SERVER_PORT...${NC}"
    lsof -ti:$MAIN_SERVER_PORT | xargs kill -9 2>/dev/null || true
    lsof -ti:$BOT_SERVER_PORT | xargs kill -9 2>/dev/null || true

    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Checks
check_prerequisites() {
    echo -e "${BLUE}Checking prerequisites...${NC}"

    if ! command -v uv >/dev/null 2>&1; then
        echo -e "${RED}uv is not installed${NC}"
        exit 1
    fi

    # Redis is strictly required for Matchmaking & Actor State
    if ! redis-cli ping >/dev/null 2>&1; then
        echo -e "${YELLOW}Redis not running. Starting Redis...${NC}"
        redis-server --daemonize yes
        sleep 2
    fi

    echo -e "${GREEN}Prerequisites OK${NC}"
}

# Migrations
run_migrations() {
    echo -e "${BLUE}Running migrations...${NC}"

    cd "$SERVER_DIR"
    uv run python manage.py migrate --noinput

    cd "$BOT_DIR"
    uv run python manage.py migrate --noinput

    echo -e "${GREEN}Migrations complete${NC}"
}

# Services
start_main_server() {
    echo -e "${BLUE}Starting Daphne (port $MAIN_SERVER_PORT)...${NC}"
    cd "$SERVER_DIR"

    # Daphne will automatically spin up the Actor System within its workers
    uv run daphne -p $MAIN_SERVER_PORT core.asgi:application \
        > "$MAIN_SERVER_LOG" 2>&1 &

    echo $! > "$MAIN_SERVER_PID"
}

start_bot_server() {
    echo -e "${BLUE}Starting Bot server (port $BOT_SERVER_PORT)...${NC}"
    cd "$BOT_DIR"

    uv run python manage.py runserver 0.0.0.0:$BOT_SERVER_PORT \
        > "$BOT_SERVER_LOG" 2>&1 &

    echo $! > "$BOT_SERVER_PID"
}

# Monitor
monitor_services() {
    echo -e "${GREEN}All services running${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Main Server : http://localhost:$MAIN_SERVER_PORT"
    echo "Bot Server  : http://localhost:$BOT_SERVER_PORT"
    echo "Admin       : http://localhost:$MAIN_SERVER_PORT/admin"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Logs:"
    echo "  tail -f $MAIN_SERVER_LOG"
    echo "  tail -f $BOT_SERVER_LOG"
    echo -e "${YELLOW}Ctrl+C to stop${NC}"

    while true; do
        sleep 1
        for pidfile in \
            "$MAIN_SERVER_PID" \
            "$BOT_SERVER_PID"
        do
            if [ -f "$pidfile" ]; then
                kill -0 "$(cat "$pidfile")" 2>/dev/null || cleanup
            fi
        done
    done

# Main
main() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Chess Platform (uv) - Starting${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    check_prerequisites
    run_migrations
    start_main_server
    sleep 2
    start_bot_server
    monitor_services
}

main