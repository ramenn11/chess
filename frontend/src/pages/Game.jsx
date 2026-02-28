import React, { useState, useEffect, useCallback, useReducer, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import useWebSocket from '../services/socketService';
import gameService from '../services/gameService'; // Ensure this service exists in your project
import { Handshake, Loader2, Trophy } from 'lucide-react';

import ChessBoard from '../components/chess/ChessBoard';
import GameClock from '../components/chess/GameClock';
import GameControls from '../components/chess/GameControls';
import MoveHistory from '../components/chess/MoveHistory';
import CapturedPieces from '../components/chess/CapturedPieces';
import ChatBox from '../components/chess/ChatBox';
import PromotionModal from '../components/chess/PromotionModal';

import Board from '../chess/Board';
import MoveValidator from '../chess/MoveValidator';
import useSound from '../hooks/useSound';

// --- 1. Unified Game Reducer ---
const initialGameState = {
  board: new Board(),
  turn: 'white',
  status: 'ongoing',
  check: null,
  whiteTime: 300000,
  blackTime: 300000,
  increment: 0,
  moves: [],
  capturedPieces: { white: [], black: [] },
  lastMove: null,
  winner: null,
  termination: null,
  whitePlayer: null,
  blackPlayer: null,
  playerColor: null,
  isSpectator: false,
  isInitialized: false,
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'INIT_GAME': {
      const { data, user } = action.payload;
      const isWhite = user?.id === data.white_player?.id;
      const isBlack = user?.id === data.black_player?.id;
      const board = new Board(data.fen || data.current_fen);

      // Calculate captured pieces from initial moves
      const captured = { white: [], black: [] };
      const serverMoves = (data.moves || []).map(m => {
        if (m.captured) {
          captured[m.color === 'white' ? 'white' : 'black'].push(m.captured);
        }
        return {
          from: m.from, to: m.to, piece: m.piece, captured: m.captured,
          notation: m.notation || m.algebraic_notation, color: m.color,
          timestamp: m.timestamp || Date.now(), sequence: m.sequence || m.move_number,
        };
      });

      return {
        ...state,
        board,
        turn: data.current_turn || board.turn,
        check: data.check,
        whitePlayer: data.white_player,
        blackPlayer: data.black_player,
        whiteTime: data.white_time || data.white_time_left,
        blackTime: data.black_time || data.black_time_left,
        increment: data.increment || 0,
        playerColor: isWhite ? 'white' : isBlack ? 'black' : 'white',
        isSpectator: !isWhite && !isBlack,
        status: data.status,
        winner: data.winner,
        moves: serverMoves,
        capturedPieces: captured,
        lastMove: serverMoves.length > 0 ? serverMoves[serverMoves.length - 1] : null,
        isInitialized: true,
      };
    }

    case 'OPPONENT_MOVED': {
      const { moveData, fen, status, winner } = action.payload;
      const newBoard = new Board(fen || moveData.fen);

      const newCaptured = { ...state.capturedPieces };
      if (moveData.captured) {
        newCaptured[moveData.color].push(moveData.captured);
      }

      const confirmedMoves = state.moves.filter(m => !m.optimistic);
      const newMove = {
        from: moveData.from, to: moveData.to, piece: moveData.piece,
        captured: moveData.captured, notation: moveData.notation, color: moveData.color,
        timestamp: moveData.timestamp || Date.now(), sequence: moveData.sequence,
      };

      return {
        ...state,
        board: newBoard,
        turn: moveData.color === 'white' ? 'black' : 'white',
        check: moveData.is_check ? (moveData.color === 'white' ? 'black' : 'white') : null,
        status: moveData.status || status || state.status,
        winner: moveData.winner || winner || state.winner,
        moves: [...confirmedMoves, newMove],
        capturedPieces: newCaptured,
        lastMove: { from: moveData.from, to: moveData.to },
      };
    }

    case 'OPTIMISTIC_MOVE': {
      const { tempBoard, move, capturedPiece } = action.payload;
      const newCaptured = { ...state.capturedPieces };

      if (capturedPiece) {
        newCaptured[state.turn].push(capturedPiece.type);
      }

      return {
        ...state,
        board: tempBoard,
        moves: [...state.moves, move],
        capturedPieces: newCaptured,
        lastMove: { from: move.from, to: move.to }
      };
    }

    case 'SYNC_CLOCKS':
      return {
        ...state,
        whiteTime: action.payload.white_time,
        blackTime: action.payload.black_time
      };

    case 'STATE_SNAPSHOT': {
      const newBoard = new Board(action.payload.fen);
      return {
        ...state,
        board: newBoard,
        turn: newBoard.turn,
        check: action.payload.check,
        whiteTime: action.payload.white_time,
        blackTime: action.payload.black_time,
        lastMove: action.payload.last_move,
      };
    }

    case 'GAME_ENDED':
      return {
        ...state,
        status: action.payload.status,
        winner: action.payload.winner,
        termination: action.payload.reason || action.payload.termination
      };

    default:
      return state;
  }
}

export default function Game() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const { playMove, playCheckmate, preloadSounds } = useSound();
  const navigate = useNavigate();

  // --- 2. React Query: Fetch Initial State & Mutations ---
  const { data: initialGameData, isLoading: isQueryLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => gameService.getGame(gameId),
    refetchOnWindowFocus: false,
  });

  const resignMutation = useMutation({
    mutationFn: () => gameService.resign(gameId),
    onSuccess: () => send && send({ type: 'resign' }),
  });

  // --- 3. Unified State Management ---
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const validator = useMemo(() => new MoveValidator(state.board), [state.board]);

  // UI Specific State (Ephemeral/Modals)
  const [moveInProgress, setMoveInProgress] = useState(false);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [pendingMove, setPendingMove] = useState(null);
  const [drawOffer, setDrawOffer] = useState(null);
  const [showDrawOfferModal, setShowDrawOfferModal] = useState(false);
  const [showGameEndedModal, setShowGameEndedModal] = useState(false);
  const [error, setError] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [chatMessageHandler, setChatMessageHandler] = useState(null);

  // Sound Preloading & Scroll Management
  useEffect(() => {
    preloadSounds();
  }, [preloadSounds]);

  const preventAutoScrollRef = useRef(null);
  const suppressScrollTemporarily = useCallback(() => {
    const savedScrollY = window.scrollY;
    preventAutoScrollRef.current = true;
    const handler = () => {
      if (preventAutoScrollRef.current) window.scrollTo(0, savedScrollY);
    };
    window.addEventListener('scroll', handler, { passive: false });
    setTimeout(() => {
      preventAutoScrollRef.current = false;
      window.removeEventListener('scroll', handler);
    }, 100);
  }, []);

  // Initialize state once React Query fetches data
  useEffect(() => {
    if (initialGameData?.game) {
      dispatch({ type: 'INIT_GAME', payload: { data: initialGameData.game, user } });
    }
  }, [initialGameData, user]);

  // --- 4. WebSocket Integration ---
  const { isConnected, send } = useWebSocket(`/ws/game/${gameId}/`, {
    onOpen: () => setConnectionError(null),
    onError: () => setConnectionError('Connection failed. Please check your internet.'),
    onClose: (event) => {
      if (event.code === 1008 || event.code === 4001) {
        setConnectionError('Session expired. Please login again.');
        setTimeout(() => navigate('/login'), 3000);
      }
    },
    onMessage: (data) => {
      switch (data.type) {
        case 'game_state':
          // Fallback if React Query didn't populate it or WS sends authoritative full state
          if (!state.isInitialized) {
            dispatch({ type: 'INIT_GAME', payload: { data, user } });
          }
          break;
        case 'move_made':
          setMoveInProgress(false);
          playMove({ isCapture: data.move.captured, isCheck: data.move.is_check });
          dispatch({
            type: 'OPPONENT_MOVED',
            payload: { moveData: data.move, fen: data.fen, status: data.status, winner: data.winner }
          });
          break;
        case 'clock_sync':
          dispatch({ type: 'SYNC_CLOCKS', payload: data });
          break;
        case 'state_snapshot':
          dispatch({ type: 'STATE_SNAPSHOT', payload: data });
          break;
        case 'game_ended':
          if (data.status === 'checkmate') playCheckmate();
          dispatch({ type: 'GAME_ENDED', payload: data });
          setShowGameEndedModal(true);
          break;
        case 'draw_offer':
          setDrawOffer({ from: data.offer_from, username: data.username });
          setShowDrawOfferModal(true);
          break;
        case 'draw_declined':
          setDrawOffer(null);
          setShowDrawOfferModal(false);
          setError('Draw offer was declined');
          setTimeout(() => setError(null), 3000);
          break;
        case 'chat_message':
          if (chatMessageHandler) chatMessageHandler(data);
          break;
        case 'error':
          setMoveInProgress(false);
          setError(data.message);
          setTimeout(() => setError(null), 5000);
          if (send) send({ type: 'join_game' }); // Reload desync
          break;
        default:
          console.warn('⚠️ Unknown message type:', data.type);
      }
    }
  });

  // Join game upon WS connection
  useEffect(() => {
    if (isConnected && send) send({ type: 'join_game' });
  }, [isConnected, send]);

  // --- 5. Game Actions ---
  const executeMove = useCallback((from, to, promotion = null) => {
    if (!validator.isValidMove(from, to, promotion)) {
      setError('Invalid move');
      setTimeout(() => setError(null), 3000);
      return;
    }

    suppressScrollTemporarily();
    setMoveInProgress(true);

    const tempBoard = state.board.clone();
    const piece = { ...tempBoard.getPiece(from) };
    const capturedPiece = tempBoard.getPiece(to);

    if (promotion && piece.type === 'pawn') piece.type = promotion;
    tempBoard.board[to] = piece;
    delete tempBoard.board[from];

    dispatch({
      type: 'OPTIMISTIC_MOVE',
      payload: {
        tempBoard,
        capturedPiece,
        move: {
          from, to,
          piece: piece.type,
          captured: capturedPiece?.type,
          notation: `${from}-${to}`,
          color: state.board.turn,
          optimistic: true,
          timestamp: Date.now()
        }
      }
    });

    if (send) {
      send({ type: 'move', payload: { from, to, promotion, timestamp: Date.now() } });
    }
  }, [state.board, validator, send, suppressScrollTemporarily]);

  const handleMove = useCallback((from, to) => {
    if (moveInProgress) return;
    if (state.isSpectator || state.status !== 'ongoing') return;
    if (state.board.turn !== state.playerColor) return;

    const piece = state.board.getPiece(from);
    if (!piece || piece.color !== state.playerColor) return;

    if (piece.type === 'pawn') {
      const toCoord = state.board.squareToCoordinate(to);
      const promotionRank = piece.color === 'white' ? 7 : 0;
      if (toCoord.rank === promotionRank) {
        setPendingMove({ from, to });
        setShowPromotionModal(true);
        return;
      }
    }
    executeMove(from, to, null);
  }, [moveInProgress, state, executeMove]);

  const handlePromotion = useCallback((promotionPiece) => {
    setShowPromotionModal(false);
    if (pendingMove) {
      executeMove(pendingMove.from, pendingMove.to, promotionPiece);
      setPendingMove(null);
    }
  }, [pendingMove, executeMove]);

  // Controls Handlers
  const handleMoveClick = (index) => send && send({ type: 'jump_to_move', payload: { move_index: index } });
  const handleResign = () => resignMutation.mutate();
  const handleOfferDraw = () => send && send({ type: 'offer_draw' });
  const handleRequestTakeback = () => send && send({ type: 'request_takeback' });
  const handleAcceptDraw = () => {
    if (send) send({ type: 'accept_draw' });
    setShowDrawOfferModal(false);
    setDrawOffer(null);
  };
  const handleDeclineDraw = () => {
    if (send) send({ type: 'decline_draw' });
    setShowDrawOfferModal(false);
    setDrawOffer(null);
  };

  const getValidMoves = useCallback((square) => validator.getPieceMoves(square), [validator]);
  const registerChatHandler = useCallback((handler) => setChatMessageHandler(() => handler), []);

  // --- 6. Render ---
  if (isQueryLoading || !state.isInitialized || state.playerColor === null) {
    return (
      <div className="container mx-auto max-w-7xl h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading game...</p>
        </div>
      </div>
    );
  }

  const isWhitePerspective = state.playerColor === 'white';

  return (
    <div className="container mx-auto max-w-7xl game-layout-strict min-h-screen flex flex-col py-4 px-4 overflow-hidden">
      {connectionError && (
        <div className="fixed top-20 right-6 bg-orange-500/90 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {connectionError}
          <button onClick={() => setConnectionError(null)} className="ml-4 font-bold">×</button>
        </div>
      )}

      {error && (
        <div className="fixed top-20 right-6 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-4 font-bold">×</button>
        </div>
      )}

      {/* Added min-h-0 here to ensure grid children don't stretch indefinitely */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(250px,280px)] gap-4 flex-1 overflow-hidden min-h-0">

        {/* LEFT COLUMN: Chat & Controls */}
        <div className="flex flex-col space-y-4 order-2 xl:order-1 overflow-hidden">
          <div className="flex-shrink-0 h-64">
            <ChatBox
              gameId={gameId}
              isPlayerChat={!state.isSpectator}
              currentUser={user}
              websocketSend={send}
              onMessage={registerChatHandler}
            />
          </div>

          <GameClock
            initialTime={isWhitePerspective ? state.blackTime : state.whiteTime}
            increment={state.increment}
            isActive={state.status === 'ongoing' && state.turn !== state.playerColor}
            color={isWhitePerspective ? 'black' : 'white'}
            playerName={isWhitePerspective ? state.blackPlayer?.username : state.whitePlayer?.username}
            playerRating={isWhitePerspective ? state.blackPlayer?.rating : state.whitePlayer?.rating}
          />

          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4 flex-shrink-0">
            <CapturedPieces
              capturedPieces={state.capturedPieces}
              color={isWhitePerspective ? 'black' : 'white'}
            />
          </div>

          <GameControls
            isSpectator={state.isSpectator}
            onResign={handleResign}
            onOfferDraw={handleOfferDraw}
            onRequestTakeback={handleRequestTakeback}
            gameStatus={state.status}
            drawOfferReceived={showDrawOfferModal}
            onAcceptDraw={handleAcceptDraw}
            onDeclineDraw={handleDeclineDraw}
          />
        </div>

        {/* MIDDLE COLUMN: The Board */}
        {/* Added min-h-0 to explicitly bound the flex container */}
        <div className="flex items-center justify-center order-1 xl:order-2 min-h-0 overflow-hidden p-2">
          {/* Constrained max width so the board never blows past vertical viewport */}
          <div className="w-full max-w-[80vh] aspect-square">
            <ChessBoard
              gameState={{
                board: state.board.board,
                turn: state.board.turn,
                check: state.check,
                status: state.status,
                winner: state.winner,
                lastMove: state.lastMove,
              }}
              onMove={handleMove}
              isSpectator={state.isSpectator}
              playerColor={state.playerColor}
              getValidMoves={getValidMoves}
            />
          </div>
        </div>

        {/* RIGHT COLUMN: History & Player Clock */}
        {/* Changed overflow-y-auto to overflow-hidden so child flex containers control scroll */}
        <div className="flex flex-col space-y-4 order-3 xl:order-3 overflow-hidden">
          <GameClock
            initialTime={isWhitePerspective ? state.whiteTime : state.blackTime}
            increment={state.increment}
            isActive={state.status === 'ongoing' && state.turn === state.playerColor}
            color={state.playerColor}
            playerName={isWhitePerspective ? state.whitePlayer?.username : state.blackPlayer?.username}
            playerRating={isWhitePerspective ? state.whitePlayer?.rating : state.blackPlayer?.rating}
          />

          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4 flex-shrink-0">
            <CapturedPieces
              capturedPieces={state.capturedPieces}
              color={state.playerColor}
            />
          </div>

          {/* Required absolute bounds (flex-1 min-h-0 flex flex-col) for Virtuoso to calculate height */}
          <div className="flex-1 min-h-0 flex flex-col">
            <MoveHistory
              moves={state.moves.filter(m => !m.optimistic)}
              currentMoveIndex={state.moves.length - 1} // simplified for reducer approach
              onMoveClick={handleMoveClick}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      {showDrawOfferModal && (
        <DrawOfferModal
          isOpen={showDrawOfferModal}
          offerFrom={drawOffer}
          onAccept={handleAcceptDraw}
          onDecline={handleDeclineDraw}
        />
      )}

      <PromotionModal
        isOpen={showPromotionModal}
        color={state.playerColor}
        onSelect={handlePromotion}
      />

      {showGameEndedModal && (
        <GameEndedModal
          gameState={{ status: state.status, winner: state.winner, termination: state.termination }}
          onClose={() => setShowGameEndedModal(false)}
          onLeave={() => navigate('/')}
        />
      )}
    </div>
  );
}

// --- Subcomponents Remain Unchanged ---

function GameEndedModal({ gameState, onClose, onLeave }) {
  const isDraw = gameState.status === 'draw' || gameState.status === 'stalemate';
  const title = isDraw ? 'Game Drawn' : (gameState.winner === 'white' ? 'White Wins' : 'Black Wins');

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100]">
      <div className="bg-slate-900 rounded-2xl border border-white/20 shadow-2xl p-8 max-w-sm w-full mx-4 text-center relative">
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-900 p-4 rounded-full border border-white/20">
          <Trophy className={`w-12 h-12 ${isDraw ? 'text-slate-400' : 'text-yellow-400'}`} />
        </div>

        <div className="mt-6 mb-8">
          <h2 className="text-3xl font-black text-white mb-1 uppercase tracking-tight">{title}</h2>
          <p className="text-purple-400 font-medium text-sm tracking-widest uppercase">{gameState.termination || gameState.status}</p>
        </div>

        <div className="flex flex-col space-y-3">
          <button
            onClick={onClose}
            className="w-full px-6 py-4 rounded-xl font-bold bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Review Board
          </button>
          <button
            onClick={onLeave}
            className="w-full px-6 py-4 rounded-xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}

function DrawOfferModal({ isOpen, offerFrom, onAccept, onDecline }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border-2 border-purple-500/50 shadow-2xl p-8 max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <Handshake className="w-16 h-16 text-purple-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Draw Offer</h2>
          <p className="text-white/80">
            {offerFrom?.username} offers a draw
          </p>
        </div>

        <div className="flex space-x-4">
          <button
            onClick={onDecline}
            className="flex-1 px-6 py-3 rounded-lg font-semibold bg-white/10 hover:bg-white/20 text-white transition-all"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white transition-all"
          >
            Accept Draw
          </button>
        </div>
      </div>
    </div>
  );
}