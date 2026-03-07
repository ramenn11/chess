[**Overview**](README.md) | [**Deployment Guide**](DEPLOYMENT.md) | [**Quick Start**](QUICKSTART.md)
___

# Chess Platform - Complete Setup Guide

A full-featured online chess platform with peer-to-peer multiplayer, AI bot opponents, matchmaking, and real-time gameplay.

## 🏗️ Architecture Overview
<img width="2816" height="1536" alt="image" src="https://github.com/user-attachments/assets/a81060c1-e65f-495f-9e6f-b748dd62c6fd" />
/>


## 📋 Prerequisites

### Required
- **Python 3.10+**
- **Node.js 18+** and npm
- **Redis** (for WebSocket channels and Celery)
- **PostgreSQL** (recommended for production) or SQLite (development)

### Installation

#### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install python3 python3-pip python3-venv nodejs npm redis-server postgresql postgresql-contrib
```

#### macOS
```bash
brew install python node redis postgresql
```

#### Windows
- Install Python from python.org
- Install Node.js from nodejs.org
- Install Redis from Microsoft Archive or use WSL
- Install PostgreSQL from postgresql.org

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd chess-platform
```

### 2. Run Installation Script
```bash
chmod +x setup.sh
./setup.sh
```

This will:
- Create virtual environments for both servers
- Install all Python dependencies
- Install frontend dependencies
- Run database migrations
- Create default admin user
- Set up environment files

### 3. Configure Environment
Edit `.env` file with your settings:

```env
# Main Server
SECRET_KEY=your-secret-key-here
DATABASE_URL=postgresql://user:password@localhost:5432/chess_db
REDIS_URL=redis://localhost:6379/0

# Chess Bot
BOT_SECRET_KEY=your-bot-secret-key-here

# Ports
MAIN_SERVER_PORT=8000
BOT_SERVER_PORT=8001
```

### 4. Start All Services
```bash
./start_all.sh
```

This single command starts:
- Main Server (Daphne on port 8000)
- Chess Bot (Django on port 8001)
- Celery Worker (background tasks)
- Celery Beat (scheduled tasks)

### 5. Start Frontend (Separate Terminal)
```bash
cd frontend
npm run dev
```

## 🎯 Access Points

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:3000 | Main application |
| **Main API** | http://localhost:8000 | REST API & WebSocket |
| **Bot API** | http://localhost:8001 | Chess bot microservice |
| **Admin Panel** | http://localhost:8000/admin | Django admin (admin/admin123) |

## 🎮 Features

### 1. Play Against Computer
- **Route**: `/game/computer`
- **Difficulty Levels**:
  - Easy: 0.5s think time (~depth 2-3)
  - Medium: 2s think time (~depth 4-5)
  - Hard: 5s think time (~depth 6-8)
  - Expert: 10s think time (~depth 9-12)

### 2. Multiplayer (P2P)
- **Route**: `/game/:gameId`
- Real-time WebSocket communication
- Time controls: Bullet, Blitz, Rapid
- Spectator mode
- Chat system

### 3. Matchmaking
- **Route**: `/matchmaking`
- Automatic opponent matching by rating
- Multiple time control options
- Queue management with Celery

### 4. Game Features
- Legal move validation
- Check/checkmate detection
- Pawn promotion
- Castling
- En passant
- Move history
- Rating system (ELO-based)

## 🔧 Development

### Running Services Individually

#### Main Server
```bash
cd server
source venv/bin/activate
daphne -p 8000 core.asgi:application
```

#### Chess Bot
```bash
cd chess_bot
source venv/bin/activate
python manage.py runserver 8001
```

#### Celery Worker
```bash
cd server
source venv/bin/activate
celery -A core worker --loglevel=info
```

#### Celery Beat
```bash
cd server
source venv/bin/activate
celery -A core beat --loglevel=info
```

#### Frontend
```bash
cd frontend
npm run dev
```

### Database Migrations

#### Main Server
```bash
cd server
source venv/bin/activate
python manage.py makemigrations
python manage.py migrate
```

#### Chess Bot
```bash
cd chess_bot
source venv/bin/activate
python manage.py makemigrations
python manage.py migrate
```

## 📁 Project Structure

```
chess-platform/
├── server/                 # Main Django server (P2P)
│   ├── core/              # Django settings & config
│   ├── accounts/          # User authentication
│   ├── game/              # Game logic & WebSocket
│   ├── manage.py
│   └── requirements.txt
│
├── chess_bot/             # Chess bot microservice
│   ├── bot/               # Django settings
│   ├── ai/                # Chess engine
│   │   ├── engine/        # Move generation & search
│   │   ├── views.py       # API endpoints
│   │   └── urls.py
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/              # React frontend
│   ├── src/
│   │   ├── pages/         # Route pages
│   │   ├── components/    # React components
│   │   ├── services/      # API services
│   │   └── chess/         # Chess logic
│   ├── package.json
│   └── vite.config.js
│
├── logs/                  # Service logs
├── .env                   # Environment variables
├── .env.template         # Environment template
├── setup.sh              # Installation script
├── start_all.sh          # Master startup script
├── docker-compose.yml    # Docker configuration
└── README.md
```

## 🐳 Docker Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

## 🧪 Testing

### Test Bot API
```bash
curl -X POST http://localhost:8001/api/bot/move/ \
  -H "Content-Type: application/json" \
  -d '{
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "time_ms": 2000
  }'
```

### Test Health Endpoints
```bash
# Main server
curl http://localhost:8000/api/game/health/

# Bot server
curl http://localhost:8001/api/bot/health/
```

## Monitoring

### View Logs
```bash
# Main server
tail -f logs/main_server.log

# Bot server
tail -f logs/bot_server.log

# Celery worker
tail -f logs/celery_worker.log

# Celery beat
tail -f logs/celery_beat.log
```

### Redis Monitor
```bash
redis-cli monitor
```

### Celery Flower (Optional)
```bash
cd server
celery -A core flower
# Access at http://localhost:5555
```

### Database Migration Issues
```bash
# Reset database (CAUTION: Deletes all data)
cd server
python manage.py flush
python manage.py migrate
```


## 📝 API Documentation

### Bot API Endpoints

#### POST /api/bot/move/
Get best move from bot
```json
{
  "fen": "string",
  "time_ms": 2000
}
```

#### POST /api/bot/validate/
Validate move legality
```json
{
  "fen": "string",
  "move": "e2e4"
}
```

#### GET /api/bot/health/
Check bot service health

### Main Server API
See main server documentation for P2P game endpoints.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Chess engine inspired by Sebastian Lague's Chess AI series
- Frontend design inspired by Chess.com and Lichess
- Built with Django, React, and modern web technologies
