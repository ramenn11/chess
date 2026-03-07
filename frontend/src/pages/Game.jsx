import React, { useState, useEffect, useCallback, useReducer, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import useWebSocket from '../services/socketService';
import gameService from '../services/gameService';
import { Handshake, Loader2, Trophy, RotateCcw } from 'lucide-react';

import ChessBoard from '../components/chess/ChessBoard';
import CompactPlayerClock from '../components/chess/CompactPlayerClock';
import GameControls from '../components/chess/GameControls';
import MoveHistory from '../components/chess/MoveHistory';
import ChatBox from '../components/chess/ChatBox';
import PromotionModal from '../components/chess/PromotionModal';

import Board from '../chess/Board';
import MoveValidator from '../chess/MoveValidator';
import useSound from '../hooks/useSound';

// unified game reducer
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
      const isWhite = user?.id === data.white_player_id || user?.id === data.white_player?.id;
      const isBlack = user?.id === data.black_player_id || user?.id === data.black_player?.id;
      const board = new Board(data.initial_fen || data.fen || data.current_fen);

      const captured = { white: [], black: [] };
      const parsedMoves = [];

      // Handle BOTH Redis MoveNodes array AND Postgres string array (backward compatible)
      const moveHistoryArray = data.moves
        ? data.moves.map(m => typeof m === 'string' ? m : m.uci)
        : (data.move_history || []);

      // Replay UCI strings to rebuild move history and board state
      for (let i = 0; i < moveHistoryArray.length; i++) {
        const uci = moveHistoryArray[i];
        const from = uci.substring(0, 2);
        const to = uci.substring(2, 4);
        const color = i % 2 === 0 ? 'white' : 'black';
        const promotion = uci.length === 5 ? uci[4] : null;

        const piece = board.getPiece(from);
        const capturedPiece = board.getPiece(to);

        if (capturedPiece) {
          captured[color].push(capturedPiece.type);
        }

        if (piece) {
          if (promotion) piece.type = promotion;
          board.board[to] = piece;
          delete board.board[from];
        }

        parsedMoves.push({ from, to, uci, color });
      }
      board.turn = moveHistoryArray.length % 2 === 0 ? 'white' : 'black';

      return {
        ...state,
        board,
        turn: data.current_turn || board.turn,
        check: data.check,
        whitePlayer: data.white_player,
        blackPlayer: data.black_player,
        whiteTime: data.white_time || data.white_time_left || data.initial_time * 1000,
        blackTime: data.black_time || data.black_time_left || data.initial_time * 1000,
        increment: data.increment || 0,
        playerColor: isWhite ? 'white' : isBlack ? 'black' : 'white',
        isSpectator: !isWhite && !isBlack,
        status: data.status,
        winner: data.winner,
        moves: parsedMoves,
        capturedPieces: captured,
        lastMove: parsedMoves.length > 0 ? parsedMoves[parsedMoves.length - 1] : null,
        isInitialized: true,
      };
    }

    case 'SET_PLAYER_METADATA': {
      const { data, user } = action.payload;
      const isWhite = user?.id === data.white_player?.id;
      const isBlack = user?.id === data.black_player?.id;

      return {
        ...state,
        whitePlayer: data.white_player,
        blackPlayer: data.black_player,
        playerColor: isWhite ? 'white' : isBlack ? 'black' : 'white',
        isSpectator: !isWhite && !isBlack,
      };
    }

    case 'OPPONENT_MOVED': {
      // Destructure 'move' instead of 'moveData', and remove 'status'/'winner'
      const { move, white_time, black_time } = action.payload;

      // Extract from/to from the new UCI string (e.g., "e2e4")
      const fromSq = move.uci.substring(0, 2);
      const toSq = move.uci.substring(2, 4);

      // Reconstruct the board
      const newBoard = state.board.clone();
      const piece = newBoard.getPiece(fromSq);
      const capturedPiece = newBoard.getPiece(toSq);

      // Handle promotion char if it exists (e.g., "e7e8q")
      const promotion = move.uci.length === 5 ? move.uci[4] : null;
      if (promotion && piece) piece.type = promotion;

      if (piece) {
        newBoard.board[toSq] = piece;
        delete newBoard.board[fromSq];
      }
      newBoard.turn = move.color === 'white' ? 'black' : 'white';

      const newCaptured = { ...state.capturedPieces };
      if (capturedPiece) {
        newCaptured[move.color].push(capturedPiece.type);
      }

      const newMove = {
        from: fromSq,
        to: toSq,
        uci: move.uci,
        notation: move.notation,
        color: move.color,
        time_left: move.time_left,
        timestamp: move.timestamp || Date.now(),
      };

      return {
        ...state,
        board: newBoard,
        turn: newBoard.turn,
        whiteTime: white_time !== undefined ? white_time : state.whiteTime,
        blackTime: black_time !== undefined ? black_time : state.blackTime,
        check: move.is_check ? (move.color === 'white' ? 'black' : 'white') : null,
        // status and winner are removed here—they are now exclusively handled by GAME_ENDED
        moves: [...state.moves.filter(m => !m.optimistic), newMove],
        capturedPieces: newCaptured,
        lastMove: { from: fromSq, to: toSq },
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
        termination: action.payload.termination
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

  // react query: fetch initial state only
  const { data: initialGameData, isLoading: isQueryLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => gameService.getGame(gameId),
    refetchOnWindowFocus: false,
  });

  // Dispatch ONLY metadata from the REST API
  useEffect(() => {
    if (initialGameData?.game) {
      dispatch({
        type: 'SET_PLAYER_METADATA',
        payload: { data: initialGameData.game, user }
      });
    }
  }, [initialGameData, user]);

  // Unified State Management
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const validator = useMemo(() => new MoveValidator(state.board), [state.board]);

  const [moveInProgress, setMoveInProgress] = useState(false);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [pendingMove, setPendingMove] = useState(null);
  const [drawOffer, setDrawOffer] = useState(null);
  const [showDrawOfferModal, setShowDrawOfferModal] = useState(false);
  const [showGameEndedModal, setShowGameEndedModal] = useState(false);
  const [error, setError] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [takebackOffer, setTakebackOffer] = useState(null);
  const [showTakebackModal, setShowTakebackModal] = useState(false);
  const [chatMessageHandler, setChatMessageHandler] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [boardTheme, setBoardTheme] = useState('brown');
  const [pieceSet, setPieceSet] = useState('cburnett');
  const [viewingMoveIndex, setViewingMoveIndex] = useState(null);
  const [historicalBoard, setHistoricalBoard] = useState(null);

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
        case 'game_sync': // listen for the new sync event
          if (!state.isInitialized) {
            // pass data.state because the Actor nests the payload under 'state'
            dispatch({ type: 'INIT_GAME', payload: { data: data.state, user } });
          }
          break;
        case 'move_made':
          setMoveInProgress(false);
          playMove({ isCapture: !!data.move?.captured, isCheck: data.move?.is_check });
          dispatch({
            type: 'OPPONENT_MOVED',
            payload: {
              move: data.move, // Map directly to 'move' instead of 'moveData'
              white_time: data.white_time,
              black_time: data.black_time
            }
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
        case 'takeback_request':
          setTakebackOffer(data);
          setShowTakebackModal(true);
          break;
        case 'takeback_accepted':
          dispatch({
            type: 'STATE_SNAPSHOT',
            payload: { fen: data.fen, check: null, white_time: state.whiteTime, black_time: state.blackTime, last_move: null }
          });
          setShowTakebackModal(false);
          setTakebackOffer(null);
          setError('Takeback accepted');
          setTimeout(() => setError(null), 3000);
          break;
        case 'error':
          setMoveInProgress(false);
          setError(data.message);
          setTimeout(() => setError(null), 5000);
          if (send) send({ type: 'join_game' });
          break;
        default:
          console.warn('⚠️ Unknown message type:', data.type);
      }
    }
  });

  useEffect(() => {
    if (isConnected && send) send({ type: 'join_game' });
  }, [isConnected, send]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const confirmedMoves = state.moves.filter(m => !m.optimistic);
      const maxIndex = confirmedMoves.length - 1;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewingMoveIndex(prev => {
          if (prev === null) {
            const newIndex = maxIndex;
            reconstructBoardAtMove(newIndex);
            return newIndex;
          } else if (prev > 0) {
            const newIndex = prev - 1;
            reconstructBoardAtMove(newIndex);
            return newIndex;
          }
          return prev;
        });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewingMoveIndex(prev => {
          if (prev === null) return null;
          if (prev >= maxIndex) {
            setHistoricalBoard(null);
            return null;
          }
          const newIndex = prev + 1;
          reconstructBoardAtMove(newIndex);
          return newIndex;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.moves]);

  const reconstructBoardAtMove = useCallback((moveIndex) => {
    const confirmedMoves = state.moves.filter(m => !m.optimistic);
    const board = new Board();

    for (let i = 0; i <= moveIndex && i < confirmedMoves.length; i++) {
      const move = confirmedMoves[i];
      const piece = board.getPiece(move.from);
      if (piece) {
        board.board[move.to] = piece;
        delete board.board[move.from];
        board.turn = move.color === 'white' ? 'black' : 'white';
      }
    }

    setHistoricalBoard(board);
  }, [state.moves]);

  // game actions
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

    const uciMove = promotion ? `${from}${to}${promotion}` : `${from}${to}`;
    if (send) {
      send({ type: 'move', payload: { uci: uciMove, timestamp: Date.now() } });
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

  // controls handlers (strictly websockets)
  const handleMoveClick = useCallback((index) => {
    setViewingMoveIndex(index);
    reconstructBoardAtMove(index);
  }, [reconstructBoardAtMove]);

  const handleReturnToLive = useCallback(() => {
    setViewingMoveIndex(null);
    setHistoricalBoard(null);
  }, []);

  const handleResign = useCallback(() => {
    if (send) send({ type: 'resign' });
  }, [send]);

  const handleOfferDraw = useCallback(() => {
    if (send) send({ type: 'offer_draw' });
  }, [send]);

  const handleRequestTakeback = useCallback(() => {
    if (send) send({ type: 'request_takeback' });
  }, [send]);

  const handleAcceptDraw = useCallback(() => {
    if (send) send({ type: 'accept_draw' });
    setShowDrawOfferModal(false);
    setDrawOffer(null);
  }, [send]);

  const handleDeclineDraw = useCallback(() => {
    if (send) send({ type: 'decline_draw' });
    setShowDrawOfferModal(false);
    setDrawOffer(null);
  }, [send]);

  const handleAcceptTakeback = useCallback(() => {
    if (send) send({ type: 'accept_takeback' });
    setShowTakebackModal(false);
    setTakebackOffer(null);
  }, [send]);

  const handleDeclineTakeback = useCallback(() => {
    if (send) send({ type: 'decline_takeback' });
    setShowTakebackModal(false);
    setTakebackOffer(null);
  }, [send]);

  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleCloseSettings = useCallback(() => setShowSettings(false), []);

  const getValidMoves = useCallback((square) => validator.getPieceMoves(square), [validator]);
  const registerChatHandler = useCallback((handler) => setChatMessageHandler(() => handler), []);

  // render
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
    <div className="h-[calc(100vh-140px)] bg-[#312e2b] flex flex-col overflow-hidden">
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

      <div className="flex-1 flex items-center justify-center p-2 gap-2">
        <div className="w-[220px] h-full flex flex-col bg-[#272522] rounded shadow-lg overflow-hidden">
          <ChatBox
            gameId={gameId}
            isPlayerChat={!state.isSpectator}
            currentUser={user}
            websocketSend={send}
            onMessage={registerChatHandler}
          />
        </div>

        <div className="aspect-square h-full max-h-full relative">
          <div className="w-full h-full">
            <ChessBoard
              gameState={{
                board: historicalBoard ? historicalBoard.board : state.board.board,
                turn: historicalBoard ? historicalBoard.turn : state.board.turn,
                check: state.check,
                status: state.status,
                winner: state.winner,
                lastMove: viewingMoveIndex !== null ? {
                  from: state.moves[viewingMoveIndex]?.from,
                  to: state.moves[viewingMoveIndex]?.to
                } : state.lastMove,
              }}
              onMove={handleMove}
              isSpectator={state.isSpectator}
              playerColor={state.playerColor}
              getValidMoves={getValidMoves}
              boardTheme={boardTheme}
              pieceSet={pieceSet}
              isViewingHistory={viewingMoveIndex !== null}
            />
          </div>

          {viewingMoveIndex !== null && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 backdrop-blur-sm text-white/90 px-4 py-1.5 rounded-full shadow-lg z-10">
              <span className="text-xs font-medium">Move {viewingMoveIndex + 1}</span>
              <button
                onClick={handleReturnToLive}
                className="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded-full font-semibold transition-colors"
              >
                LIVE
              </button>
            </div>
          )}
        </div>

        <div className="w-[220px] h-full flex flex-col gap-1">
          <CompactPlayerClock
            initialTime={isWhitePerspective ? state.blackTime : state.whiteTime}
            increment={state.increment}
            isActive={state.status === 'ongoing' && state.turn !== state.playerColor}
            color={isWhitePerspective ? 'black' : 'white'}
            playerName={isWhitePerspective ? state.blackPlayer?.username : state.whitePlayer?.username}
            playerRating={isWhitePerspective ? state.blackPlayer?.rating : state.whitePlayer?.rating}
          />

          <div className="flex-1 bg-[#1e1c1a] rounded shadow-lg overflow-hidden min-h-0">
            <MoveHistory
              moves={state.moves.filter(m => !m.optimistic)}
              currentMoveIndex={state.moves.length - 1}
              onMoveClick={handleMoveClick}
              viewingMoveIndex={viewingMoveIndex}
              onReturnToLive={handleReturnToLive}
            />
          </div>

          <CompactPlayerClock
            initialTime={isWhitePerspective ? state.whiteTime : state.blackTime}
            increment={state.increment}
            isActive={state.status === 'ongoing' && state.turn === state.playerColor}
            color={state.playerColor}
            playerName={isWhitePerspective ? state.whitePlayer?.username : state.blackPlayer?.username}
            playerRating={isWhitePerspective ? state.whitePlayer?.rating : state.blackPlayer?.rating}
          />

          <GameControls
            isSpectator={state.isSpectator}
            onResign={handleResign}
            onOfferDraw={handleOfferDraw}
            onRequestTakeback={handleRequestTakeback}
            gameStatus={state.status}
            drawOfferReceived={showDrawOfferModal}
            onAcceptDraw={handleAcceptDraw}
            onDeclineDraw={handleDeclineDraw}
            onOpenSettings={handleOpenSettings}
          />
        </div>
      </div>

      {showSettings && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
          onClick={handleCloseSettings}
        >
          <div
            className="bg-[#272522] rounded-lg p-4 shadow-2xl w-64"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Board Settings</h3>
              <button
                onClick={handleCloseSettings}
                className="text-white/50 hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-white/70 text-sm block mb-1">Board Theme</label>
                <select
                  value={boardTheme}
                  onChange={(e) => setBoardTheme(e.target.value)}
                  className="w-full bg-[#312e2b] border border-white/20 text-white rounded px-3 py-2 text-sm"
                >
                  <option value="brown">Brown</option>
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                  <option value="purple">Purple</option>
                </select>
              </div>

              <div>
                <label className="text-white/70 text-sm block mb-1">Piece Set</label>
                <select
                  value={pieceSet}
                  onChange={(e) => setPieceSet(e.target.value)}
                  className="w-full bg-[#312e2b] border border-white/20 text-white rounded px-3 py-2 text-sm"
                >
                  <option value="cburnett">Classic</option>
                  <option value="alpha">Alpha</option>
                  <option value="merida">Merida</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

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

      <TakebackModal
        isOpen={showTakebackModal}
        offerFrom={takebackOffer}
        onAccept={handleAcceptTakeback}
        onDecline={handleDeclineTakeback}
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

function TakebackModal({ isOpen, offerFrom, onAccept, onDecline }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border-2 border-blue-500/50 shadow-2xl p-8 max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <RotateCcw className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Takeback Request</h2>
          <p className="text-white/80">
            {offerFrom?.username} requests a takeback
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
            className="flex-1 px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white transition-all"
          >
            Accept Takeback
          </button>
        </div>
      </div>
    </div>
  );
}