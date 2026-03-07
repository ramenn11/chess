import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, ArrowLeft, Clock } from 'lucide-react';
import api from '../../services/api';
import ChessBoard from '../chess/ChessBoard';

// Helper to translate FEN from Redis/Engine into the dictionary format ChessBoard.jsx expects
const parseFenToBoard = (fen) => {
    if (!fen) return {};
    const board = {};
    const rows = fen.split(' ')[0].split('/');
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const typeMap = {
        'p': 'pawn', 'n': 'knight', 'b': 'bishop',
        'r': 'rook', 'q': 'queen', 'k': 'king'
    };

    rows.forEach((row, rankIdx) => {
        let fileIdx = 0;
        const rank = 8 - rankIdx;
        for (let char of row) {
            if (!isNaN(char)) {
                fileIdx += parseInt(char);
            } else {
                const color = char === char.toUpperCase() ? 'white' : 'black';
                const type = typeMap[char.toLowerCase()];
                board[`${files[fileIdx]}${rank}`] = { color, type };
                fileIdx++;
            }
        }
    });
    return board;
};

function SpectatorView() {
    const { gameId } = useParams();
    const navigate = useNavigate();
    const [streamData, setStreamData] = useState(null);
    const [boardOrientation, setBoardOrientation] = useState('white');

    // Formatted state for your custom ChessBoard.jsx
    const [gameState, setGameState] = useState({
        board: {},
        turn: 'white',
        status: 'ongoing',
        lastMove: null,
        check: null,
        winner: null,
    });

    useEffect(() => {
        // 1. Fetch Initial Snapshot from the new Redis REST endpoint
        const fetchSnapshot = async () => {
            try {
                const response = await api.get(`/game/games/live/${gameId}/`);
                const data = response.data;

                setStreamData(data);
                setGameState({
                    board: parseFenToBoard(data.fen),
                    turn: data.fen.split(' ')[1] === 'w' ? 'white' : 'black',
                    status: data.status || 'ongoing',
                    lastMove: data.last_move || null,
                });
            } catch (error) {
                console.error("Failed to load live snapshot:", error);
            }
        };

        fetchSnapshot();

        // 2. Connect to Read-Only WebSocket Stream
        // Replace with your actual WS URL configuration
        const wsUrl = `ws://localhost:8000/ws/spectate/${gameId}/`;
        const socket = new WebSocket(wsUrl);

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'move_made') {
                // Update both the wrapper data and the formatted ChessBoard state
                setStreamData(prev => ({
                    ...prev,
                    fen: data.payload.fen,
                    move_count: data.payload.move_count,
                }));

                setGameState(prev => ({
                    ...prev,
                    board: parseFenToBoard(data.payload.fen),
                    turn: data.payload.fen.split(' ')[1] === 'w' ? 'white' : 'black',
                    lastMove: data.payload.last_move,
                    status: data.payload.status || prev.status,
                    check: data.payload.in_check ? (data.payload.fen.split(' ')[1] === 'w' ? 'white' : 'black') : null,
                }));
            }
            else if (data.type === 'clock_tick') {
                setStreamData(prev => ({
                    ...prev,
                    white_time: data.payload.white_time,
                    black_time: data.payload.black_time
                }));
            }
            else if (data.type === 'game_over') {
                setGameState(prev => ({
                    ...prev,
                    status: data.payload.reason, // 'checkmate', 'resignation', etc.
                    winner: data.payload.winner
                }));
            }
        };

        return () => socket.close();
    }, [gameId]);

    const formatTime = (ms) => {
        if (!ms) return "0:00";
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    if (!streamData) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <p className="text-white/60 animate-pulse text-xl">Tuning into live stream...</p>
            </div>
        );
    }

    // Determine top/bottom player UI based on board orientation
    const topPlayer = boardOrientation === 'white' ? streamData.black_player : streamData.white_player;
    const bottomPlayer = boardOrientation === 'white' ? streamData.white_player : streamData.black_player;
    const topTime = boardOrientation === 'white' ? streamData.black_time : streamData.white_time;
    const bottomTime = boardOrientation === 'white' ? streamData.white_time : streamData.black_time;

    return (
        <div className="container mx-auto p-4 max-w-5xl flex flex-col items-center">
            {/* Header */}
            <div className="w-full flex items-center justify-between mb-8">
                <button
                    onClick={() => navigate('/spectate')}
                    className="flex items-center text-white/60 hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 mr-2" /> Back to Lobby
                </button>

                <div className="flex items-center space-x-4 bg-white/5 border border-white/10 rounded-full px-4 py-2">
                    <div className="flex items-center text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse mr-2"></span>
                        LIVE
                    </div>
                    <div className="w-px h-4 bg-white/20"></div>
                    <div className="flex items-center text-white/80">
                        <Users className="w-4 h-4 mr-2" />
                        {streamData.spectators || 1} Viewers
                    </div>
                </div>

                <button
                    onClick={() => setBoardOrientation(prev => prev === 'white' ? 'black' : 'white')}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-all"
                >
                    Flip Board
                </button>
            </div>

            {/* Main Game Area */}
            <div className="flex flex-col md:flex-row gap-8 items-start">

                {/* Board & Clocks */}
                <div className="flex flex-col w-[600px]">

                    {/* Top Player Info */}
                    <div className="flex justify-between items-center mb-4 bg-white/5 p-4 rounded-lg border border-white/10">
                        <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${boardOrientation === 'white' ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}>
                                {boardOrientation === 'white' ? '♚' : '♔'}
                            </div>
                            <div>
                                <p className="text-white font-bold text-lg">{topPlayer?.username || 'Player'}</p>
                                <p className="text-white/60 text-sm">{topPlayer?.rating || '?'}</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-2 bg-black/50 px-4 py-2 rounded font-mono text-2xl text-white">
                            <Clock className="w-5 h-5 text-white/40" />
                            <span>{formatTime(topTime)}</span>
                        </div>
                    </div>

                    {/* The Custom Chess Board */}
                    <div className="shadow-2xl shadow-purple-900/20 rounded-xl overflow-hidden pointer-events-none">
                        <ChessBoard
                            gameState={gameState}
                            isSpectator={true}
                            playerColor={boardOrientation}
                            boardTheme="default"
                            pieceSet="standard"
                            onMove={() => { }} // Disabled for spectators
                        />
                    </div>

                    {/* Bottom Player Info */}
                    <div className="flex justify-between items-center mt-4 bg-white/5 p-4 rounded-lg border border-white/10">
                        <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${boardOrientation === 'white' ? 'bg-white text-gray-900' : 'bg-gray-800 text-white'}`}>
                                {boardOrientation === 'white' ? '♔' : '♚'}
                            </div>
                            <div>
                                <p className="text-white font-bold text-lg">{bottomPlayer?.username || 'Player'}</p>
                                <p className="text-white/60 text-sm">{bottomPlayer?.rating || '?'}</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-2 bg-black/50 px-4 py-2 rounded font-mono text-2xl text-white">
                            <Clock className="w-5 h-5 text-white/40" />
                            <span>{formatTime(bottomTime)}</span>
                        </div>
                    </div>

                </div>

                {/* Right Sidebar (Chat / Move History) */}
                <div className="w-[300px] h-[750px] bg-white/5 border border-white/10 rounded-xl flex flex-col">
                    <div className="p-4 border-b border-white/10 text-white font-bold">
                        Spectator Chat
                    </div>
                    <div className="flex-1 flex flex-col p-4 text-white/40 justify-center items-center text-center">
                        <Users className="w-12 h-12 mb-4 opacity-20" />
                        Chat component goes here.<br />(Plug in src/components/spectate/Chat.jsx)
                    </div>
                </div>

            </div>
        </div>
    );
}

export default SpectatorView;