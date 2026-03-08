[**Overview**](README.md) | [**Deployment Guide**](DEPLOYMENT.md) | [**Quick Start**](QUICKSTART.md)
___

# Chess Platform - Complete Setup Guide

A full-featured online chess platform with peer-to-peer multiplayer, AI bot opponents, matchmaking, and real-time gameplay.

# Real-Time Chess Platform

A highly concurrent real-time chess platform built using **Django ASGI**, **WebSockets**, and a **process-isolated Actor system** for deterministic game execution.

The system is designed to support **thousands of concurrent games**, while ensuring:

* strict move ordering
* deterministic game state
* minimal database contention
* horizontal scalability

---

# Architecture

<img width="2816" height="1536" alt="image" src="https://github.com/user-attachments/assets/a81060c1-e65f-495f-9e6f-b748dd62c6fd" />

The platform separates responsibilities into three major layers:

1. **Network Layer (ASGI / WebSockets)**
2. **Game Execution Layer (Actor System)**
3. **Persistence & Infrastructure Layer**

This separation allows the system to scale each component independently.

---

# System Design

## 1. Network Layer

The network layer is implemented using:

* **Django ASGI**
* **Django Channels**
* **Daphne**

Responsibilities:

* Accept WebSocket connections
* Authenticate players
* Route messages to the correct game
* Broadcast events to clients
* Handle reconnections and spectators

Each WebSocket connection is handled inside an **async event loop**, allowing a single process to support thousands of simultaneous connections.

The network layer **does not contain game logic**.
It only acts as a **high-performance message router**.

Example flow:

```
Client
  ↓
WebSocket Connection
  ↓
Django Channels Consumer
  ↓
Forward message to GameActor
```

---

## 2. Game Execution Layer

Game logic runs inside a **Thespian Actor System**.

Each active match is assigned a dedicated:

```
GameActor
```

Properties of the actor model:

* **one actor per game**
* **sequential message processing**
* **no shared mutable state**
* **no locks required**

Every move sent by a player becomes a **message** to the GameActor.

Example flow:

```
Player Move (e2e4)
     ↓
Channels Consumer
     ↓
Actor.tell(move)
     ↓
GameActor validates move
     ↓
GameActor updates state
     ↓
Event published to Redis
     ↓
Clients receive update
```

Because actors process messages sequentially, race conditions such as:

* simultaneous moves
* clock desynchronization
* state corruption

are structurally impossible.

The actor also owns:

* chess engine validation
* move ordering
* clock calculations
* game state updates

Actors run as **separate OS processes**, allowing the system to fully utilize multiple CPU cores.

---

## 3. Redis Infrastructure Layer

Redis is used as the **real-time coordination layer**.

It provides three main capabilities.

### Shared Game State

Game state is stored in Redis during active matches.

Example key:

```
game:{id}:state
```

Stored information:

* move list
* clock values
* players
* game status

This allows players to reconnect without querying the database.

---

### Event Streaming

Actors publish updates using Redis Pub/Sub.

Example channel:

```
game:{id}:events
```

WebSocket consumers subscribe to this channel and forward events to connected clients.

This allows:

* real-time move broadcasting
* spectator mode
* low-latency updates

---

### Atomic Matchmaking

Matchmaking is implemented using **Redis Sorted Sets**.

Players enter the queue with their rating as score:

```
matchmaking:queue
```

A Lua script performs atomic pairing:

1. pop players from queue
2. compare rating difference
3. create game if compatible

Because the operation runs inside Redis as a script, the entire matchmaking process is **atomic and race-free**.

---

## 4. Persistence Layer

PostgreSQL is used only for **long-term storage**.

Active gameplay does **not** interact with the database.

Database writes occur only when a game finishes.

Stored information includes:

* players
* result
* timestamps
* move list
* rating updates

This approach removes the database from the real-time execution path, eliminating a major performance bottleneck.

---

# Technology Stack

Backend

* Django
* Django Channels
* Daphne
* Thespian Actor System
* Redis
* PostgreSQL
* Python

Frontend

* React
* Vite
* TailwindCSS

Infrastructure

* Docker
* Terraform
* GitHub Actions

---

# Repository Structure

```
ramenn11-chess
│
├── README.md
├── DEPLOYMENT.md
├── QUICKSTART.md
├── diagnose.sh
├── docker-compose.yml
├── start_all.sh
├── FILE_STRUCTURE.md
│
├── server
│   ├── core
│   │   ├── asgi.py
│   │   ├── jwt_auth_middleware.py
│   │   └── settings.py
│   │
│   ├── accounts
│   │   ├── models.py
│   │   ├── views.py
│   │   └── redis_pubsub.py
│   │
│   └── game
│       ├── consumers.py
│       ├── routing.py
│       ├── matchmaking.lua
│       ├── matchmaking.py
│       ├── chess_engine.py
│       ├── state.py
│       │
│       └── actors
│           ├── system.py
│           ├── game_actor.py
│           └── db_actor.py
│
├── chess_bot
│   └── ai
│       └── engine
│           ├── board.py
│           ├── move_generator.py
│           ├── evaluation.py
│           ├── searcher.py
│           └── transposition_table.py
│
├── frontend
│   ├── src
│   │   ├── pages
│   │   ├── components
│   │   ├── hooks
│   │   ├── services
│   │   └── chess
│   │       ├── Board.js
│   │       └── MoveValidator.js
│
├── Terraform
│   └── main.tf
│
└── .github
    └── workflows
        └── ci-cd.yml
```

---

# Core Features

### Real-Time Multiplayer

* WebSocket-based gameplay
* deterministic move ordering
* reconnection support
* spectator mode

### Atomic Matchmaking

* Redis sorted sets
* Lua-based pairing logic
* Elo-based matchmaking

### Chess Engine Integration

Custom Python engine supporting:

* legal move validation
* check detection
* checkmate detection
* repetition tracking
* transposition tables
* opening book support

### Bot Gameplay

Players can compete against an AI opponent powered by the custom engine.

Difficulty is adjusted through:

* search depth
* computation time
* move ordering heuristics

---

# Running the Project

Start backend services:

```
./start_all.sh
```

Start frontend:

```
cd frontend
npm install
npm run dev
```

---

# Access Points

| Service     | URL                         |
| ----------- | --------------------------- |
| Frontend    | http://localhost:3000       |
| Main API    | http://localhost:8000       |
| Bot API     | http://localhost:8001       |
| Admin Panel | http://localhost:8000/admin |

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## License

This project is licensed under the MIT License.

## Acknowledgments

- Chess engine inspired by Sebastian Lague's Chess AI series
- Frontend design inspired by Chess.com and Lichess
- Built with Django, React, and modern web technologies
