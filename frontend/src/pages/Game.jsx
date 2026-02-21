import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useWebSocket from '../services/socketService';
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

function Game() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const { playMove, playCheckmate, preloadSounds } = useSound();
  const navigate = useNavigate();

  // Core game state
  const [board, setBoard] = useState(new Board());
  const [validator, setValidator] = useState(new MoveValidator(board));
  const [gameState, setGameState] = useState({
    status: 'ongoing',
    turn: 'white',
    check: null,
    winner: null,
    lastMove: null,
  });

  // Player info
  const [whitePlayer, setWhitePlayer] = useState(null);
  const [blackPlayer, setBlackPlayer] = useState(null);
  const [playerColor, setPlayerColor] = useState(null);
  const [isSpectator, setIsSpectator] = useState(false);

  // Clock state - in milliseconds
  const [whiteTime, setWhiteTime] = useState(300000);
  const [blackTime, setBlackTime] = useState(300000);
  const [timeIncrement, setTimeIncrement] = useState(0);

  // Move history and UI
  const [moves, setMoves] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [capturedPieces, setCapturedPieces] = useState({ white: [], black: [] });
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [pendingMove, setPendingMove] = useState(null);
  const [drawOffer, setDrawOffer] = useState(null);
  const [showDrawOfferModal, setShowDrawOfferModal] = useState(false);
  const [moveInProgress, setMoveInProgress] = useState(false);

  // UI feedback
  const [error, setError] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Chat handler
  const [chatMessageHandler, setChatMessageHandler] = useState(null);

  // Update validator when board changes
  useEffect(() => {
    setValidator(new MoveValidator(board));
  }, [board]);

  useEffect(() => {
    preloadSounds();
  }, [preloadSounds]);

  // Prevent auto-scroll when moves are made (focus on inputs can cause scrolling)
  const preventAutoScrollRef = useRef(null);

  const suppressScrollTemporarily = useCallback(() => {
    const savedScrollY = window.scrollY;
    preventAutoScrollRef.current = true;

    const handler = (e) => {
      if (preventAutoScrollRef.current) {
        window.scrollTo(0, savedScrollY);
      }
    };

    window.addEventListener('scroll', handler, { passive: false });

    setTimeout(() => {
      preventAutoScrollRef.current = false;
      window.removeEventListener('scroll', handler);
    }, 100);
  }, []);


  // WEBSOCKET MESSAGE HANDLERS

  const handleGameState = useCallback((data) => {
    console.log('🎮 Initializing game state:', data);

    // Set players
    setWhitePlayer(data.white_player);
    setBlackPlayer(data.black_player);

    // Determine player color
    if (user?.id === data.white_player?.id) {
      setPlayerColor('white');
      setIsSpectator(false);
    } else if (user?.id === data.black_player?.id) {
      setPlayerColor('black');
      setIsSpectator(false);
    } else {
      setIsSpectator(true);
      setPlayerColor('white');
    }

    // Load board from FEN
    const newBoard = new Board(data.fen || data.current_fen);
    setBoard(newBoard);

    // Set clocks
    setWhiteTime(data.white_time || data.white_time_left);
    setBlackTime(data.black_time || data.black_time_left);
    setTimeIncrement(data.increment || 0);

    // Load moves history
    const serverMoves = (data.moves || []).map(m => ({
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured,
      notation: m.notation || m.algebraic_notation,
      color: m.color,
      timestamp: m.timestamp || Date.now(),
      sequence: m.sequence || m.move_number,
    }));

    setMoves(serverMoves);
    setCurrentMoveIndex(serverMoves.length - 1);

    // Calculate captured pieces from moves
    const whiteCaptured = [];
    const blackCaptured = [];
    serverMoves.forEach(move => {
      if (move.captured) {
        if (move.color === 'white') {
          whiteCaptured.push(move.captured);
        } else {
          blackCaptured.push(move.captured);
        }
      }
    });
    setCapturedPieces({ white: whiteCaptured, black: blackCaptured });

    // Set game state
    setGameState({
      status: data.status,
      turn: data.current_turn || newBoard.turn,
      check: data.check,
      winner: data.winner,
      lastMove: serverMoves.length > 0 ? serverMoves[serverMoves.length - 1] : null,
    });

    setIsInitialized(true);
  }, [user]);

  const handleOpponentMove = useCallback((data) => {
    console.log('♟️ Move received:', data);

    const moveData = data.move;
    if (!moveData) return;

    // Play sound based on move type
    playMove({
      isCapture: moveData.captured,
      isCheck: moveData.is_check
    });

    // Clear move-in-progress flag
    setMoveInProgress(false);

    // Remove optimistic moves, add confirmed server move
    setMoves(prev => {
      const confirmed = prev.filter(m => !m.optimistic);
      return [...confirmed, {
        from: moveData.from,
        to: moveData.to,
        piece: moveData.piece,
        captured: moveData.captured,
        notation: moveData.notation,
        color: moveData.color,
        timestamp: moveData.timestamp || Date.now(),
        sequence: moveData.sequence,
      }];
    });

    // ✅ ALWAYS load board from server FEN (authoritative)
    if (data.fen || moveData.fen) {
      const newBoard = new Board(data.fen || moveData.fen);
      setBoard(newBoard);
      console.log('📥 Board updated from server FEN, turn:', newBoard.turn);
    }

    // Update clocks FROM SERVER
    if (data.white_time !== undefined) setWhiteTime(data.white_time);
    if (data.black_time !== undefined) setBlackTime(data.black_time);

    // Update captured pieces
    if (moveData.captured) {
      setCapturedPieces(prev => ({
        ...prev,
        [moveData.color]: [...prev[moveData.color], moveData.captured],
      }));
    }

    // Update game state - use board.turn from FEN
    setGameState(prev => ({
      ...prev,
      status: moveData.status || data.status || prev.status,
      turn: moveData.color === 'white' ? 'black' : 'white',
      check: moveData.is_check ? (moveData.color === 'white' ? 'black' : 'white') : null,
      lastMove: { from: moveData.from, to: moveData.to },
      winner: moveData.winner || data.winner || prev.winner,
    }));

    setCurrentMoveIndex(prev => prev + 1);
  }, []);

  const handleClockSync = useCallback((data) => {
    setWhiteTime(data.white_time);
    setBlackTime(data.black_time);
  }, []);

  const handleStateSnapshot = useCallback((data) => {
    const newBoard = new Board(data.fen);
    setBoard(newBoard);

    setWhiteTime(data.white_time);
    setBlackTime(data.black_time);
    setCurrentMoveIndex(data.move_index);

    setGameState(prev => ({
      ...prev,
      turn: newBoard.turn,
      check: data.check,
      lastMove: data.last_move,
    }));
  }, []);

  const [showGameEndedModal, setShowGameEndedModal] = useState(false);

  const handleGameEnded = useCallback((data) => {
    console.log('🏁 Game ended:', data);

    if (data.status === 'checkmate') {
      playCheckmate();
    }

    setGameState(prev => ({
      ...prev,
      status: data.status,
      winner: data.winner,
      termination: data.reason || data.termination,
    }));

    setShowGameEndedModal(true);

    if (data.rating_changes) {
      console.log('📊 Rating changes:', data.rating_changes);
    }
  }, [playCheckmate]);

  const handleDrawOffer = useCallback((data) => {
    setDrawOffer({
      from: data.offer_from,
      username: data.username,
    });
    setShowDrawOfferModal(true);
  }, []);

  const handleDrawDeclined = useCallback(() => {
    setDrawOffer(null);
    setShowDrawOfferModal(false);
    setError('Draw offer was declined');
    setTimeout(() => setError(null), 3000);
  }, []);

  const handleMoveError = useCallback((errorMessage) => {
    console.error('❌ Move error:', errorMessage);
    setMoveInProgress(false);
    setError(errorMessage);
    setTimeout(() => setError(null), 5000);

    // Reload board from server to fix any desync
    if (send) {
      send({ type: 'join_game' });
    }
  }, []);

  const handleWebSocketMessage = useCallback((data) => {
    console.log('📨 WebSocket message:', data.type);

    switch (data.type) {
      case 'game_state':
        handleGameState(data);
        break;
      case 'move_made':
        handleOpponentMove(data);
        break;
      case 'clock_sync':
        handleClockSync(data);
        break;
      case 'state_snapshot':
        handleStateSnapshot(data);
        break;
      case 'game_ended':
        handleGameEnded(data);
        break;
      case 'draw_offer':
        handleDrawOffer(data);
        break;
      case 'draw_declined':
        handleDrawDeclined();
        break;
      case 'chat_message':
        if (chatMessageHandler) {
          chatMessageHandler(data);
        }
        break;
      case 'error':
        handleMoveError(data.message);
        break;
      default:
        console.warn('⚠️ Unknown message type:', data.type);
    }
  }, [
    handleGameState,
    handleOpponentMove,
    handleClockSync,
    handleStateSnapshot,
    handleGameEnded,
    handleDrawOffer,
    handleDrawDeclined,
    handleMoveError,
    chatMessageHandler,
  ]);

  // WEBSOCKET CONNECTION
  const handleWsOpen = useCallback(() => {
    console.log('✅ WebSocket connected');
    setConnectionError(null);
  }, []);

  const handleWsError = useCallback((err) => {
    console.error('❌ WebSocket error:', err);
    setConnectionError('Connection failed. Please check your internet.');
  }, []);

  const handleWsClose = useCallback((event) => {
    console.log('🔌 WebSocket closed:', event.code);
    if (event.code === 1008 || event.code === 4001) {
      setConnectionError('Session expired. Please login again.');
      setTimeout(() => navigate('/login'), 3000);
    }
  }, [navigate]);

  const { isConnected, send } = useWebSocket(
    `/ws/game/${gameId}/`,
    {
      onOpen: handleWsOpen,
      onMessage: handleWebSocketMessage,
      onError: handleWsError,
      onClose: handleWsClose,
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 3,
    }
  );

  // Join game after connection
  useEffect(() => {
    if (isConnected && send) {
      console.log('📤 Joining game...');
      send({ type: 'join_game' });
    }
  }, [isConnected, send]);

  const executeMove = useCallback((from, to, promotion = null) => {
    console.log('🎯 Executing move:', from, to, promotion);

    // Validate move first
    if (!validator.isValidMove(from, to, promotion)) {
      setError('Invalid move');
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Suppress scroll during move
    suppressScrollTemporarily();

    // ✅ Set move in progress IMMEDIATELY
    setMoveInProgress(true);

    const piece = board.getPiece(from);
    const capturedPiece = board.getPiece(to);

    // ✅ Create optimistic update WITHOUT switching turn
    const tempBoard = board.clone();
    const tempPiece = { ...tempBoard.getPiece(from) };

    if (promotion && tempPiece.type === 'pawn') {
      tempPiece.type = promotion;
    }

    tempBoard.board[to] = tempPiece;
    delete tempBoard.board[from];
    // ❌ DON'T switch turn - let server do it

    setBoard(tempBoard);

    // Add optimistic move to history
    const optimisticMove = {
      from,
      to,
      piece: piece.type,
      captured: capturedPiece?.type,
      notation: `${from}-${to}`,
      color: board.turn,
      optimistic: true,
      timestamp: Date.now(),
    };

    setMoves(prev => [...prev, optimisticMove]);
    setCurrentMoveIndex(prev => prev + 1);

    // Update captured pieces optimistically
    if (capturedPiece) {
      setCapturedPieces(prev => ({
        ...prev,
        [board.turn]: [...prev[board.turn], capturedPiece.type],
      }));
    }

    // Update last move
    setGameState(prev => ({
      ...prev,
      lastMove: { from, to },
    }));

    // Send to server
    if (send) {
      send({
        type: 'move',
        payload: { from, to, promotion, timestamp: Date.now() },
      });
    }
  }, [board, validator, send]);

  const handleMove = useCallback((from, to) => {
    // Prevent rapid moves
    if (moveInProgress) {
      console.log('⏳ Wait for previous move to complete');
      return;
    }

    if (isSpectator || gameState.status !== 'ongoing') {
      console.log('Cannot move - spectator or game not ongoing');
      return;
    }

    if (board.turn !== playerColor) {
      console.log('Not your turn - Board turn:', board.turn, 'Your color:', playerColor);
      return;
    }

    const piece = board.getPiece(from);
    if (!piece || piece.color !== playerColor) {
      console.log('Invalid piece selection');
      return;
    }

    // Check for pawn promotion
    if (piece.type === 'pawn') {
      const toCoord = board.squareToCoordinate(to);
      const promotionRank = piece.color === 'white' ? 7 : 0;

      if (toCoord.rank === promotionRank) {
        setPendingMove({ from, to });
        setShowPromotionModal(true);
        return;
      }
    }

    executeMove(from, to, null);
  }, [moveInProgress, isSpectator, gameState.status, board, playerColor, executeMove]);

  const handlePromotion = useCallback((promotionPiece) => {
    setShowPromotionModal(false);
    if (pendingMove) {
      executeMove(pendingMove.from, pendingMove.to, promotionPiece);
      setPendingMove(null);
    }
  }, [pendingMove, executeMove]);

  const handleMoveClick = useCallback((index) => {
    if (send) {
      send({
        type: 'jump_to_move',
        payload: { move_index: index },
      });
    }
  }, [send]);

  const handleResign = useCallback(() => {
    if (send) {
      send({ type: 'resign' });
    }
  }, [send]);

  const handleOfferDraw = useCallback(() => {
    if (send) {
      send({ type: 'offer_draw' });
    }
  }, [send]);

  const handleAcceptDraw = useCallback(() => {
    if (send) {
      send({ type: 'accept_draw' });
      setShowDrawOfferModal(false);
      setDrawOffer(null);
    }
  }, [send]);

  const handleDeclineDraw = useCallback(() => {
    if (send) {
      send({ type: 'decline_draw' });
      setShowDrawOfferModal(false);
      setDrawOffer(null);
    }
  }, [send]);

  const handleRequestTakeback = useCallback(() => {
    if (send) {
      send({ type: 'request_takeback' });
    }
  }, [send]);

  const getValidMoves = useCallback((square) => {
    return validator.getPieceMoves(square);
  }, [validator]);

  const registerChatHandler = useCallback((handler) => {
    setChatMessageHandler(() => handler);
  }, []);


  // RENDER

  // Don't render board until playerColor is definitively set
  if (!isInitialized || playerColor === null) {
    return (
      <div className="container mx-auto max-w-7xl h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading game...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl min-h-screen overflow-hidden flex flex-col py-4">
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

      {/* ✅ CRITICAL FIX: Use flex-1 to allow grid to fill available height */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(250px,280px)] gap-4 flex-1 overflow-hidden">

        {/* LEFT COLUMN: Chat & Controls */}
        <div className="flex flex-col space-y-4 order-2 xl:order-1 overflow-y-auto">
          <div className="flex-shrink-0 h-64">
            <ChatBox
              gameId={gameId}
              isPlayerChat={!isSpectator}
              currentUser={user}
              websocketSend={send}
              onMessage={registerChatHandler}
            />
          </div>

          <GameClock
            initialTime={playerColor === 'white' ? blackTime : whiteTime}
            increment={timeIncrement}
            isActive={gameState.status === 'ongoing' && gameState.turn !== playerColor}
            color={playerColor === 'white' ? 'black' : 'white'}
            playerName={playerColor === 'white' ? blackPlayer?.username : whitePlayer?.username}
            playerRating={playerColor === 'white' ? blackPlayer?.rating : whitePlayer?.rating}
          />

          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4 flex-shrink-0">
            <CapturedPieces
              capturedPieces={capturedPieces}
              color={playerColor === 'white' ? 'black' : 'white'}
            />
          </div>

          <GameControls
            isSpectator={isSpectator}
            onResign={handleResign}
            onOfferDraw={handleOfferDraw}
            onRequestTakeback={handleRequestTakeback}
            gameStatus={gameState.status}
            drawOfferReceived={showDrawOfferModal}
            onAcceptDraw={handleAcceptDraw}
            onDeclineDraw={handleDeclineDraw}
          />
        </div>

        {/* MIDDLE COLUMN: The Board - Proper flex containment */}
        <div className="flex items-center justify-center order-1 xl:order-2 overflow-hidden p-2">
          {/* ✅ CRITICAL: Use aspect-square with w-full to maintain board proportions */}
          <div className="w-full aspect-square max-h-full">
            <ChessBoard
              gameState={{
                board: board.board,
                turn: board.turn,
                check: gameState.check,
                status: gameState.status,
                winner: gameState.winner,
                lastMove: gameState.lastMove,
              }}
              onMove={handleMove}
              isSpectator={isSpectator}
              playerColor={playerColor}
              getValidMoves={getValidMoves}
            />
          </div>
        </div>

        {/* RIGHT COLUMN: History & Player Clock */}
        <div className="flex flex-col space-y-4 order-3 xl:order-3 overflow-y-auto">
          <GameClock
            initialTime={playerColor === 'white' ? whiteTime : blackTime}
            increment={timeIncrement}
            isActive={gameState.status === 'ongoing' && gameState.turn === playerColor}
            color={playerColor}
            playerName={playerColor === 'white' ? whitePlayer?.username : blackPlayer?.username}
            playerRating={playerColor === 'white' ? whitePlayer?.rating : blackPlayer?.rating}
          />

          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4 flex-shrink-0">
            <CapturedPieces
              capturedPieces={capturedPieces}
              color={playerColor}
            />
          </div>

          <div className="flex-1 overflow-hidden">
            <MoveHistory
              moves={moves.filter(m => !m.optimistic)}
              currentMoveIndex={currentMoveIndex}
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
        color={playerColor}
        onSelect={handlePromotion}
      />

      {showGameEndedModal && (
        <GameEndedModal
          gameState={gameState}
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

export default Game;