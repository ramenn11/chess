import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Cpu, RotateCcw, Home, Loader2, Trophy, Settings, Flag } from 'lucide-react';
import Navbar from '../components/layout/NavBar';

import ChessBoard from '../components/chess/ChessBoard';
import MoveHistory from '../components/chess/MoveHistory';
import CapturedPieces from '../components/chess/CapturedPieces';
import PromotionModal from '../components/chess/PromotionModal';
import Board from '../chess/Board';
import MoveValidator from '../chess/MoveValidator';
import botService from '../services/botService';

import useSound from '../hooks/useSound';

function BotGame() {
  const navigate = useNavigate();
  const { gameId: urlGameId } = useParams();
  const { playMove, playCheckmate, preloadSounds } = useSound();

  // Use ref to track gameId for cleanup and for accessing latest state in callbacks
  const gameIdRef = useRef(null);
  const boardRef = useRef(null);
  const validatorRef = useRef(null);

  // Game session
  const [gameId, setGameId] = useState(urlGameId || null);
  const [gameLoaded, setGameLoaded] = useState(false);
  const [showGameEndedModal, setShowGameEndedModal] = useState(false);

  useEffect(() => {
    preloadSounds();
  }, [preloadSounds]);

  // Game state
  const [board, setBoard] = useState(new Board());
  const [validator, setValidator] = useState(new MoveValidator(board));
  const [gameState, setGameState] = useState({
    status: "ongoing",
    turn: "white",
    check: null,
    winner: null,
    lastMove: null,
  });

  // Bot settings
  const [difficulty, setDifficulty] = useState("medium");
  const [playerColor, setPlayerColor] = useState("white");
  const [gameStarted, setGameStarted] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // UI state
  const [moves, setMoves] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [viewIndex, setViewIndex] = useState(-1); // -1 = current game, else = viewing history
  const [capturedPieces, setCapturedPieces] = useState({
    white: [],
    black: [],
  });
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [pendingMove, setPendingMove] = useState(null);
  const [error, setError] = useState(null);
  const [showConfirmResign, setShowConfirmResign] = useState(false);

  // Board theme & keyboard navigation state
  const [showSettings, setShowSettings] = useState(false);
  const [boardTheme, setBoardTheme] = useState('brown');
  const [pieceSet, setPieceSet] = useState('cburnett');
  const [historicalBoard, setHistoricalBoard] = useState(null);

  // Update refs whenever state changes
  useEffect(() => {
    gameIdRef.current = gameId;
  }, [gameId]);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    validatorRef.current = validator;
  }, [validator]);

  // Load existing game if gameId exists in URL
  useEffect(() => {
    const isValidUUID = urlGameId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlGameId);

    if (isValidUUID && !gameLoaded) {
      loadExistingGame(urlGameId);
    } else if (!urlGameId) {
      // No game ID in URL, show difficulty selection
      setGameLoaded(true);
    }
  }, [urlGameId, gameLoaded]);


  // Handle move click in history
  const handleMoveClick = useCallback((index) => {
    setViewIndex(index);
    reconstructBoardAtMove(index);
  }, []);

  // Return to live position
  const handleReturnToLive = useCallback(() => {
    setViewIndex(-1);
    setHistoricalBoard(null);
  }, []);

  // Suppress scroll during moves
  const suppressScrollTemporarily = useCallback(() => {
    const savedScrollY = window.scrollY;
    let preventScroll = true;

    const handler = () => {
      if (preventScroll) {
        window.scrollTo(0, savedScrollY);
      }
    };

    window.addEventListener('scroll', handler, { passive: false });

    setTimeout(() => {
      preventScroll = false;
      window.removeEventListener('scroll', handler);
    }, 100);
  }, []);

  // Helper to reconstruct board at a specific move index
  const reconstructBoardAtMove = useCallback((moveIndex) => {
    const newBoard = new Board();

    // Replay moves up to the target index
    for (let i = 0; i <= moveIndex && i < moves.length; i++) {
      const move = moves[i];
      const piece = newBoard.getPiece(move.from);
      if (piece) {
        newBoard.board[move.to] = piece;
        delete newBoard.board[move.from];
        newBoard.turn = move.color === 'white' ? 'black' : 'white';
      }
    }

    setHistoricalBoard(newBoard);
  }, [moves]);

  const loadExistingGame = async (gId) => {
    setIsInitializing(true);
    try {
      const result = await botService.getGame(gId);
      if (result.success) {
        setGameId(gId);
        setDifficulty(result.difficulty);
        setPlayerColor(result.player_color);

        // Load board state
        const newBoard = new Board();
        newBoard.loadFen(result.fen);
        setBoard(newBoard);
        setValidator(new MoveValidator(newBoard));

        setGameState({
          status: "ongoing",
          turn: newBoard.turn,
          check: null,
          winner: null,
          lastMove: null,
        });

        setGameStarted(true);
        setGameLoaded(true);
      } else {
        setError("Game not found");
        setGameLoaded(true);
        setGameStarted(false);
      }
    } catch (err) {
      console.error("Load game error:", err);
      setError("Failed to load game");
      setGameLoaded(true);
      setGameStarted(false);
    } finally {
      setIsInitializing(false);
    }
  };

  // Update validator when board changes
  useEffect(() => {
    setValidator(new MoveValidator(board));
  }, [board]);

  // Cleanup on unmount only (not on gameId change)
  useEffect(() => {
    return () => {
      const currentGameId = gameIdRef.current;
      if (currentGameId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentGameId)) {
        botService.deleteGame(currentGameId).catch(() => {
          // Silently fail - game might already be deleted
        });
      }
    };
  }, []); // Empty dependency array - only runs on unmount

  const executeMove = useCallback(
    (from, to, promotion = null) => {
      const currentBoard = boardRef.current;
      const currentValidator = validatorRef.current;

      if (!currentValidator.isValidMove(from, to, promotion)) {
        setError('Invalid move');
        setTimeout(() => setError(null), 3000);
        return false;
      }

      suppressScrollTemporarily();

      const piece = currentBoard.getPiece(from);
      const capturedPiece = currentBoard.getPiece(to);

      const newBoard = currentBoard.clone();
      currentValidator.makeMove(newBoard, from, to, promotion);

      setBoard(newBoard);

      if (capturedPiece) {
        setCapturedPieces((prev) => ({
          ...prev,
          [piece.color]: [...prev[piece.color], capturedPiece.type],
        }));
      }

      const move = {
        from,
        to,
        piece: piece.type,
        captured: capturedPiece?.type,
        promotion,
        notation: `${from}-${to}${promotion ? '=' + promotion : ''}`,
        color: currentBoard.turn,
        timestamp: Date.now(),
      };

      setMoves((prev) => [...prev, move]);
      setCurrentMoveIndex((prev) => prev + 1);

      const status = currentValidator.getGameStatus();
      setGameState({
        ...status,
        turn: newBoard.turn,
        lastMove: { from, to },
      });

      return true;
    },
    [suppressScrollTemporarily]
  );

  const handlePlayerMove = useCallback(
    async (from, to) => {
      if (
        !gameId ||
        botThinking ||
        gameState.status !== "ongoing" ||
        gameState.turn !== playerColor
      ) {
        return;
      }

      const piece = board.getPiece(from);
      if (!piece || piece.color !== playerColor) {
        return;
      }

      // Check for pawn promotion
      if (piece.type === "pawn") {
        const toCoord = board.squareToCoordinate(to);
        const promotionRank = piece.color === "white" ? 7 : 0;

        if (toCoord.rank === promotionRank) {
          setPendingMove({ from, to });
          setShowPromotionModal(true);
          return;
        }
      }

      // Execute player move and send to backend
      await executeMoveAndGetBotResponse(from, to, null);
    },
    [gameId, botThinking, gameState, playerColor, board]
  );

  const executeMoveAndGetBotResponse = async (from, to, promotion = null) => {
    setBotThinking(true);
    setError(null);

    const currentBoard = boardRef.current;
    const currentValidator = validatorRef.current;
    const currentGameId = gameIdRef.current;

    console.log('🎯 Player move attempt:', { from, to, promotion, gameId: currentGameId, turn: gameState.turn });

    try {
      // Validate it's legal
      if (!currentValidator.isValidMove(from, to, promotion)) {
        setError('Invalid move');
        setBotThinking(false);
        return;
      }

      // Send move to backend
      const move = from + to + (promotion || '');
      console.log('📤 Sending to backend:', move);

      const result = await botService.makeMove(currentGameId, move);
      console.log('📊 Backend response:', result);

      if (result.success) {
        // Load the NEW board state from backend
        const newBoard = new Board();
        newBoard.loadFen(result.new_fen);
        setBoard(newBoard);
        setValidator(new MoveValidator(newBoard));

        // Update captured pieces from backend moves
        const newCaptured = { white: [], black: [] };
        if (result.moves) {
          result.moves.forEach(m => {
            if (m.captured) {
              newCaptured[m.color === 'white' ? 'white' : 'black'].push(m.captured);
            }
          });
          setCapturedPieces(newCaptured);
        }

        // Update game state
        setGameState(prev => ({
          ...prev,
          turn: newBoard.turn,
          status: result.game_over ? 'finished' : 'ongoing',
          winner: result.winner,
          lastMove: result.bot_move ? {
            from: result.bot_move.substring(0, 2),
            to: result.bot_move.substring(2, 4)
          } : { from, to }
        }));

        // Update move history
        const playerMove = {
          from,
          to,
          piece: currentBoard.getPiece(from)?.type,
          notation: `${from}-${to}${promotion ? '=' + promotion : ''}`,
          color: playerColor,
          timestamp: Date.now(),
        };

        const newMoves = [playerMove];

        if (result.bot_move) {
          const botMove = {
            from: result.bot_move.substring(0, 2),
            to: result.bot_move.substring(2, 4),
            notation: result.bot_move,
            color: playerColor === 'white' ? 'black' : 'white',
            timestamp: Date.now(),
          };
          newMoves.push(botMove);
        }

        setMoves(prev => [...prev, ...newMoves]);
        setCurrentMoveIndex(prev => prev + newMoves.length);

        // Check game over
        if (result.game_over) {
          setGameState(prev => ({
            ...prev,
            status: 'finished',
            winner: result.winner,
            result: result.result,
          }));
          setShowGameEndedModal(true);
          playCheckmate();
        } else if (result.bot_move) {
          playMove({ isCheck: result.is_check });
        } else {
          playMove({});
        }
      } else {
        setError(result.error || 'Failed to get bot response');
      }
    } catch (err) {
      console.error('❌ Move error:', err);
      setError('Move failed: ' + err.message);
    } finally {
      setBotThinking(false);
    }
  };

  const handlePromotion = useCallback(
    async (promotionPiece) => {
      setShowPromotionModal(false);
      if (pendingMove) {
        await executeMoveAndGetBotResponse(
          pendingMove.from,
          pendingMove.to,
          promotionPiece
        );
        setPendingMove(null);
      }
    },
    [pendingMove]
  );

  const startNewGame = async (selectedDifficulty, selectedColor) => {
    setError(null);
    setIsInitializing(true);

    try {
      const result = await botService.createGame(
        selectedColor,
        selectedDifficulty
      );

      if (result.success) {
        const createdGameId = result.game_id;

        setGameId(createdGameId);
        setDifficulty(selectedDifficulty);
        setPlayerColor(selectedColor);
        setGameStarted(true);

        const newBoard = new Board();
        if (result.starting_fen) {
          newBoard.loadFen(result.starting_fen);
        }
        setBoard(newBoard);
        setValidator(new MoveValidator(newBoard));

        setGameState({
          status: "ongoing",
          turn: newBoard.turn,
          check: null,
          winner: null,
          lastMove: null,
        });
        setMoves([]);
        setCurrentMoveIndex(-1);
        setCapturedPieces({ white: [], black: [] });
        setBotThinking(false);

        // Navigate to the new game URL
        navigate(`/bot/${createdGameId}`, { replace: true });

        // If bot moves first
        if (result.bot_first_move) {
          const move = result.bot_first_move;
          const from = move.substring(0, 2);
          const to = move.substring(2, 4);
          const promotion = move.length > 4 ? move[4] : null;

          setTimeout(() => executeMove(from, to, promotion), 300);
        }
      } else {
        setError("Failed to create game");
      }
    } catch (err) {
      console.error("Start game error:", err);
      setError("Failed to create game: " + err.message);
    } finally {
      setIsInitializing(false);
    }
  };

  const resetGame = async () => {
    // Delete the current game if it exists
    if (gameId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId)) {
      await botService.deleteGame(gameId).catch(() => { });
    }

    // Reset all state
    setGameId(null);
    setGameStarted(false);
    setBoard(new Board());
    setMoves([]);
    setCapturedPieces({ white: [], black: [] });
    setGameState({
      status: "ongoing",
      turn: "white",
      check: null,
      winner: null,
    });
    setError(null);
    setGameLoaded(false);

    // Navigate to clean /bot route
    navigate('/bot', { replace: true });
  };

  const getValidMoves = useCallback(
    (square) => {
      return validator.getPieceMoves(square);
    },
    [validator]
  );

  // Takeback move
  const handleTakeback = useCallback(() => {
    if (moves.length === 0 || botThinking) return;

    const newMoves = moves.slice(0, -1);
    setMoves(newMoves);
    setCurrentMoveIndex(newMoves.length - 1);
    setViewIndex(-1);
    setHistoricalBoard(null);

    // Rebuild board from moves
    const newBoard = new Board();
    const validator = new MoveValidator(newBoard);

    for (const move of newMoves) {
      validator.makeMove(newBoard, move.from, move.to, move.promotion);
    }

    setBoard(newBoard);
    setValidator(new MoveValidator(newBoard));

    const status = validator.getGameStatus();
    setGameState({
      ...status,
      turn: newBoard.turn,
      lastMove: newMoves.length > 0 ? {
        from: newMoves[newMoves.length - 1].from,
        to: newMoves[newMoves.length - 1].to
      } : null,
    });
  }, [moves, botThinking]);

  // Arrow key navigation for viewing board history
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle arrow keys if not typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const maxIndex = moves.length - 1;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewIndex(prev => {
          if (prev === null || prev === -1) {
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
        setViewIndex(prev => {
          if (prev === null || prev === -1) return -1;
          if (prev >= maxIndex) {
            setHistoricalBoard(null);
            return -1;
          }
          const newIndex = prev + 1;
          reconstructBoardAtMove(newIndex);
          return newIndex;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moves]);

  const handleResign = useCallback(() => {
    if (showConfirmResign) {
      setGameState(prev => ({
        ...prev,
        status: 'finished',
        winner: playerColor === 'white' ? 'black' : 'white',
      }));
      setShowGameEndedModal(true);
      setShowConfirmResign(false);
    } else {
      setShowConfirmResign(true);
      setTimeout(() => setShowConfirmResign(false), 3000);
    }
  }, [showConfirmResign, playerColor]);

  // Loading state
  if (isInitializing) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading game...</p>
        </div>
      </div>
    );
  }

  // Settings screen - /bot route - Purple theme
  if (!gameStarted) {
    return (
      <div className="h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-pink-900 flex items-center justify-center p-4 fixed inset-0 z-50 pt-16">
        {/* Add navbar for /bot route */}
        <div className="absolute top-0 left-0 right-0 z-10">
          <Navbar />
        </div>
        <div className="bg-black/30 backdrop-blur-lg rounded-2xl border border-white/10 p-4 w-full max-w-lg">
          <div className="text-center mb-6">
            <Cpu className="w-14 h-14 text-purple-300 mx-auto mb-3" />
            <h1 className="text-3xl font-bold text-white mb-2">Play Against Bot</h1>
            <p className="text-white/70">Configure your game settings</p>
          </div>

          {error && (
            <div className="mb-4 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Difficulty Selection */}
            <div>
              <h3 className="text-white font-semibold mb-3">Select Difficulty</h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { level: 'easy', label: 'Easy', time: '0.5s', icon: '😊', desc: 'Beginner friendly' },
                  { level: 'medium', label: 'Medium', time: '2s', icon: '🤔', desc: 'Balanced challenge' },
                  { level: 'hard', label: 'Hard', time: '5s', icon: '😈', desc: 'Advanced play' },
                ].map((diff) => (
                  <button
                    key={diff.level}
                    onClick={() => setDifficulty(diff.level)}
                    className={`p-6 rounded-xl transition-all duration-300 border-2 ${difficulty === diff.level
                      ? 'bg-white/20 border-white shadow-lg shadow-purple-500/50'
                      : 'bg-white/5 border-white/10 hover:border-white/30 hover:bg-white/10'
                      }`}
                  >
                    <div className="text-4xl mb-2">{diff.icon}</div>
                    <div className="text-white font-semibold text-lg">{diff.label}</div>
                    <div className="text-white/60 text-sm">{diff.time}</div>
                    <div className="text-white/40 text-xs mt-1">{diff.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Color Selection */}
            <div>
              <h3 className="text-white font-semibold mb-3">Choose Your Color</h3>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setPlayerColor('white')}
                  className={`p-6 rounded-xl transition-all border-2 ${playerColor === 'white'
                    ? 'bg-white/20 border-white shadow-lg shadow-white/20'
                    : 'bg-white/5 border-white/10 hover:border-white/30 hover:bg-white/10'
                    }`}
                >
                  <div className="text-4xl mb-2">♔</div>
                  <div className="text-white font-semibold">Play as White</div>
                  <div className="text-white/60 text-sm">You move first</div>
                </button>
                <button
                  onClick={() => setPlayerColor('black')}
                  className={`p-6 rounded-xl transition-all border-2 ${playerColor === 'black'
                    ? 'bg-black/50 border-gray-400 shadow-lg shadow-gray-500/30'
                    : 'bg-black/20 border-white/10 hover:border-white/30 hover:bg-black/40'
                    }`}
                >
                  <div className="text-4xl mb-2">♚</div>
                  <div className="text-white font-semibold">Play as Black</div>
                  <div className="text-white/60 text-sm">Bot moves first</div>
                </button>
              </div>
            </div>

            {/* Start Game Button */}
            <button
              onClick={() => startNewGame(difficulty, playerColor)}
              disabled={isInitializing}
              className="w-full py-4 rounded-xl font-bold text-lg bg-white/20 hover:bg-white/30 border border-white/30 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isInitializing ? (
                <><Loader2 className="w-5 h-5 animate-spin" /><span>Starting Game...</span></>
              ) : (
                <span>Start Game</span>
              )}
            </button>

            <button
              onClick={() => navigate('/')}
              className="w-full flex items-center justify-center space-x-2 bg-white/10 hover:bg-white/20 text-white rounded-lg p-3 transition-all"
            >
              <Home className="w-4 h-4" />
              <span>Back to Home</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isWhitePerspective = playerColor === 'white';

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {error && (
        <div className="fixed top-20 right-6 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-4 font-bold">×</button>
        </div>
      )}

      {/* Main Game Area - Lichess Style WITH Sidebar */}
      <div className="flex-1 flex items-center justify-center p-2 gap-2">
        {/* Center: Chess Board */}
        <div className="aspect-square h-full max-h-full relative">
          <div className="w-full h-full">
            <ChessBoard
              gameState={{
                board: historicalBoard ? historicalBoard.board : board.board,
                turn: historicalBoard ? historicalBoard.turn : board.turn,
                check: gameState.check,
                status: gameState.status,
                winner: gameState.winner,
                lastMove: viewIndex >= 0 ? {
                  from: moves[viewIndex]?.from,
                  to: moves[viewIndex]?.to
                } : gameState.lastMove,
              }}
              onMove={handlePlayerMove}
              isSpectator={viewIndex >= 0 || playerColor !== gameState.turn}
              playerColor={playerColor}
              getValidMoves={getValidMoves}
              boardTheme={boardTheme}
              pieceSet={pieceSet}
              isViewingHistory={viewIndex >= 0}
            />
          </div>

          {/* Viewing History Indicator */}
          {viewIndex >= 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 backdrop-blur-sm text-white/90 px-4 py-1.5 rounded-full shadow-lg z-10">
              <span className="text-xs font-medium">Move {viewIndex + 1}</span>
              <button
                onClick={handleReturnToLive}
                className="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded-full font-semibold transition-colors"
              >
                LIVE
              </button>
            </div>
          )}
        </div>

        {/* Right: Bot Info, Captured Pieces, History, Controls */}
        <div className="w-[220px] h-full flex flex-col gap-1">
          {/* Top - Bot Info */}
          <div className="bg-[#1e1c1a] rounded shadow-lg p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-purple-400" />
              <div>
                <p className="text-white text-sm font-medium">Bot</p>
                <p className="text-white/50 text-xs capitalize">{difficulty}</p>
              </div>
            </div>
            {botThinking && (
              <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            )}
          </div>

          {/* Bot Captured Pieces */}
          <div className="bg-[#1e1c1a] rounded shadow-lg p-2">
            <CapturedPieces
              capturedPieces={capturedPieces}
              color={playerColor === 'white' ? 'black' : 'white'}
            />
          </div>

          {/* Move History */}
          <div className="h-[50%] bg-[#1e1c1a] rounded shadow-lg overflow-hidden min-h-0">
            <MoveHistory
              moves={moves}
              currentMoveIndex={currentMoveIndex}
              onMoveClick={handleMoveClick}
              viewingMoveIndex={viewIndex >= 0 ? viewIndex : null}
              onReturnToLive={handleReturnToLive}
            />
          </div>

          {/* Player Captured Pieces */}
          <div className="bg-[#1e1c1a] rounded shadow-lg p-2">
            <CapturedPieces
              capturedPieces={capturedPieces}
              color={playerColor}
            />
          </div>

          {/* Bottom - Player Info */}
          <div className="bg-[#1e1c1a] rounded shadow-lg p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-sm ${playerColor === 'white' ? 'bg-white text-gray-900' : 'bg-gray-800 text-white border border-gray-600'}`}>
                {playerColor === 'white' ? '♔' : '♚'}
              </div>
              <p className="text-white text-sm font-medium">You</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-2 bg-[#1e1c1a] rounded shadow-lg p-2">
            {/* Resign Button */}
            <button
              onClick={handleResign}
              className={`flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-all ${showConfirmResign
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white'
                }`}
              title={showConfirmResign ? 'Click again to confirm' : 'Resign'}
            >
              <Flag className="w-4 h-4" />
              {showConfirmResign ? 'Confirm?' : 'Resign'}
            </button>

            {/* Takeback Button */}
            <button
              onClick={handleTakeback}
              disabled={moves.length === 0 || botThinking}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium bg-white/10 hover:bg-white/20 disabled:bg-gray-700 disabled:cursor-not-allowed text-white/70 hover:text-white transition-all"
              title="Take back last move"
            >
              <RotateCcw className="w-4 h-4" />
              Undo
            </button>

            {/* New Game Button */}
            <button
              onClick={resetGame}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all"
              title="Start new game"
            >
              <Home className="w-4 h-4" />
              New Game
            </button>

            {/* Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all"
              title="Board settings"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="bg-[#272522] rounded-lg p-4 shadow-2xl w-64"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Board Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
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

      <PromotionModal
        isOpen={showPromotionModal}
        color={playerColor}
        onSelect={handlePromotion}
      />

      {showGameEndedModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100]">
          <div className="bg-slate-900 rounded-2xl border border-white/20 shadow-2xl p-8 max-w-sm w-full mx-4 text-center relative">
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-900 p-4 rounded-full border border-white/20">
              <Trophy className={`w-12 h-12 ${gameState.winner ? 'text-yellow-400' : 'text-slate-400'}`} />
            </div>

            <div className="mt-6 mb-8">
              <h2 className="text-3xl font-black text-white mb-1 uppercase tracking-tight">
                {gameState.winner ? (gameState.winner === playerColor ? 'You Won!' : 'Bot Won!') : 'Game Drawn'}
              </h2>
              <p className="text-purple-400 font-medium text-sm tracking-widest uppercase">{gameState.result || 'Game Over'}</p>
            </div>

            <div className="flex flex-col space-y-3">
              <button
                onClick={() => setShowGameEndedModal(false)}
                className="w-full px-6 py-4 rounded-xl font-bold bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Review Board
              </button>
              <button
                onClick={() => navigate('/')}
                className="w-full px-6 py-4 rounded-xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Leave Room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BotGame;