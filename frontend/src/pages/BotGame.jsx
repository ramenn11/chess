import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Cpu, RotateCcw, Home, Loader2, ChevronLeft, ChevronRight, Moon, Sun, Trophy } from "lucide-react";

import ChessBoard from "../components/chess/ChessBoard";
import MoveHistory from "../components/chess/MoveHistory";
import CapturedPieces from "../components/chess/CapturedPieces";
import PromotionModal from "../components/chess/PromotionModal";
import Board from "../chess/Board";
import MoveValidator from "../chess/MoveValidator";
import botService from "../services/botService";

import useSound from "../hooks/useSound";

function BotGame() {
  const navigate = useNavigate();
  const { gameId: urlGameId } = useParams();
  const { playMove, playCheckmate, preloadSounds } = useSound();

  // Use ref to track gameId for cleanup
  const gameIdRef = useRef(null);

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

  // Update ref whenever gameId changes
  useEffect(() => {
    gameIdRef.current = gameId;
  }, [gameId]);

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


  // Suppress scroll during moves only
  const suppressScrollTemporarily = useCallback(() => {
    const savedScrollY = window.scrollY;
    let preventScroll = true;

    const handler = (e) => {
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
      if (!validator.isValidMove(from, to, promotion)) {
        setError("Invalid move");
        setTimeout(() => setError(null), 3000);
        return false;
      }

      // Suppress scroll during move
      suppressScrollTemporarily();

      const piece = board.getPiece(from);
      const capturedPiece = board.getPiece(to);

      // Create new board
      const newBoard = board.clone();
      validator.makeMove(newBoard, from, to, promotion);

      setBoard(newBoard);

      // Update captured pieces
      if (capturedPiece) {
        setCapturedPieces((prev) => ({
          ...prev,
          [piece.color]: [...prev[piece.color], capturedPiece.type],
        }));
      }

      // Add move to history
      const move = {
        from,
        to,
        piece: piece.type,
        captured: capturedPiece?.type,
        promotion,
        notation: `${from}-${to}${promotion ? "=" + promotion : ""}`,
        color: board.turn,
        timestamp: Date.now(),
      };

      setMoves((prev) => [...prev, move]);
      setCurrentMoveIndex((prev) => prev + 1);

      // Update game state
      const status = validator.getGameStatus();
      setGameState({
        ...status,
        turn: newBoard.turn,
        lastMove: { from, to },
      });

      return true;
    },
    [board, validator, suppressScrollTemporarily]
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

    console.log('🎯 Player move attempt:', { from, to, promotion, gameId, turn: gameState.turn });

    try {
      // DON'T execute locally first - let the backend be the source of truth
      // Just validate it's legal
      if (!validator.isValidMove(from, to, promotion)) {
        setError("Invalid move");
        setBotThinking(false);
        return;
      }

      // Send move to backend
      const move = from + to + (promotion || "");
      console.log('📤 Sending to backend:', move);

      const result = await botService.makeMove(gameId, move);
      console.log('📊 Backend response:', result);

      if (result.success) {
        // Load the NEW board state from backend (this includes both player and bot moves)
        const newBoard = new Board();
        newBoard.loadFen(result.new_fen);
        setBoard(newBoard);
        setValidator(new MoveValidator(newBoard));

        // Update game state
        setGameState(prev => ({
          ...prev,
          turn: newBoard.turn,
          status: result.game_over ? "finished" : "ongoing",
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
          piece: board.getPiece(from)?.type,
          notation: `${from}-${to}${promotion ? "=" + promotion : ""}`,
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
            status: "finished",
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
        setError(result.error || "Failed to get bot response");
      }
    } catch (err) {
      console.error("❌ Move error:", err);
      setError("Move failed: " + err.message);
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

  // Takeback move - removes last move and reverts board
  const handleTakeback = useCallback(() => {
    if (moves.length === 0 || botThinking) return;

    const newMoves = moves.slice(0, -1);
    setMoves(newMoves);
    setCurrentMoveIndex(newMoves.length - 1);
    setViewIndex(-1);

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
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewIndex(prev => Math.max(-1, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewIndex(prev => Math.min(moves.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moves.length]);

  // Get board state for viewing (either current or from history)
  const getDisplayBoard = useCallback(() => {
    if (viewIndex === -1) {
      return board; // Current game state
    }

    // Rebuild board up to viewIndex
    const newBoard = new Board();
    const validator = new MoveValidator(newBoard);

    for (let i = 0; i <= viewIndex && i < moves.length; i++) {
      const move = moves[i];
      validator.makeMove(newBoard, move.from, move.to, move.promotion);
    }

    return newBoard;
  }, [board, viewIndex, moves]);

  // Loading state while checking for existing game
  if (isInitializing) {
    return (
      <div className="container mx-auto max-w-4xl h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading game...</p>
        </div>
      </div>
    );
  }

  // Settings screen - shown when no game is started
  if (!gameStarted) {
    return (
      <div className="container mx-auto max-w-4xl h-screen flex items-center justify-center">
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl border border-white/10 p-8 w-full max-w-2xl">
          <div className="text-center mb-8">
            <Cpu className="w-16 h-16 text-purple-400 mx-auto mb-4" />
            <h1 className="text-4xl font-bold text-white mb-2">
              Play Against Bot
            </h1>
            <p className="text-white/60">Configure your game settings</p>
          </div>

          {error && (
            <div className="mb-6 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* Difficulty Selection */}
            <div>
              <h3 className="text-white font-semibold mb-3">
                Select Difficulty
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    level: "easy",
                    label: "Easy",
                    time: "0.5s",
                    icon: "😊",
                    desc: "Beginner friendly",
                  },
                  {
                    level: "medium",
                    label: "Medium",
                    time: "2s",
                    icon: "🤔",
                    desc: "Balanced challenge",
                  },
                  {
                    level: "hard",
                    label: "Hard",
                    time: "5s",
                    icon: "😈",
                    desc: "Advanced play",
                  },
                ].map((diff) => (
                  <button
                    key={diff.level}
                    onClick={() => setDifficulty(diff.level)}
                    className={`p-6 rounded-xl transition-all duration-300 border-2 ${difficulty === diff.level
                        ? "bg-gradient-to-br from-purple-500/30 to-pink-500/30 border-purple-500"
                        : "bg-white/5 border-white/10 hover:border-white/30"
                      }`}
                  >
                    <div className="text-4xl mb-2">{diff.icon}</div>
                    <div className="text-white font-semibold text-lg">
                      {diff.label}
                    </div>
                    <div className="text-white/60 text-sm">{diff.time}</div>
                    <div className="text-white/40 text-xs mt-1">
                      {diff.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Color Selection */}
            <div>
              <h3 className="text-white font-semibold mb-3">
                Choose Your Color
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setPlayerColor("white")}
                  className={`p-6 rounded-xl transition-all border-2 ${playerColor === "white"
                      ? "bg-white/20 border-white"
                      : "bg-white/5 border-white/10 hover:border-white/30"
                    }`}
                >
                  <div className="text-4xl mb-2">♔</div>
                  <div className="text-white font-semibold">Play as White</div>
                  <div className="text-white/60 text-sm">You move first</div>
                </button>
                <button
                  onClick={() => setPlayerColor("black")}
                  className={`p-6 rounded-xl transition-all border-2 ${playerColor === "black"
                      ? "bg-gray-900/50 border-gray-400"
                      : "bg-gray-900/20 border-white/10 hover:border-white/30"
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
              className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isInitializing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Starting Game...</span>
                </>
              ) : (
                <span>Start Game</span>
              )}
            </button>

            <button
              onClick={() => navigate("/")}
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

  // Proper grid constraints and overflow handling
  return (
    <div className="container mx-auto max-w-7xl h-screen overflow-hidden flex flex-col justify-center py-4">
      {error && (
        <div className="fixed top-20 right-6 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-4 font-bold">
            ×
          </button>
        </div>
      )}

      {/* Viewing History Indicator */}
      {viewIndex >= 0 && (
        <div className="fixed top-24 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-lg shadow-lg z-40">
          Viewing Move {viewIndex + 1} • Use ← → to navigate • Press <strong>Enter</strong> or make a move to return
        </div>
      )}

      {/*Added overflow-hidden to grid container */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_280px] gap-4 h-full overflow-hidden">
        {/* Left Sidebar - Bot Info */}
        <div className="space-y-6 overflow-y-auto">
          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Cpu className="w-8 h-8 text-purple-400" />
              <div>
                <p className="text-white font-semibold">Chess Bot</p>
                <p className="text-white/60 text-sm capitalize">
                  {difficulty} Level
                </p>
              </div>
            </div>
            {botThinking && (
              <div className="flex items-center space-x-2 text-purple-400 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>

          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
            <CapturedPieces
              capturedPieces={capturedPieces}
              color={playerColor === "white" ? "black" : "white"}
            />
          </div>

          {/* Undo Button */}
          <button
            onClick={handleTakeback}
            disabled={moves.length === 0 || botThinking}
            className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-all font-semibold flex items-center justify-center space-x-2 shadow-lg"
          >
            <RotateCcw className="w-5 h-5" />
            <span>Undo Move</span>
          </button>

          <button
            onClick={resetGame}
            className="w-full flex items-center justify-center space-x-2 bg-white/10 hover:bg-white/20 text-white rounded-lg p-3 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            <span>New Game</span>
          </button>
        </div>

        <div className="flex items-center justify-center overflow-hidden min-h-0">
          <div className="w-full h-full max-w-[min(90vh,90vw)] max-h-[min(90vh,90vw)] aspect-square">
            <ChessBoard
              gameState={{
                board: getDisplayBoard().board,
                turn: getDisplayBoard().turn,
                check: gameState.check,
                status: gameState.status,
                winner: gameState.winner,
                lastMove: gameState.lastMove,
              }}
              onMove={handlePlayerMove}
              isSpectator={viewIndex >= 0 || playerColor !== gameState.turn}
              playerColor={playerColor}
              getValidMoves={getValidMoves}
            />
          </div>
        </div>

        {/* Right Sidebar - Player Info & History */}
        <div className="space-y-6 overflow-y-auto">
          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${playerColor === "white"
                      ? "bg-white text-gray-900"
                      : "bg-gray-900 text-white"
                    }`}
                >
                  {playerColor === "white" ? "♔" : "♚"}
                </div>
                <div>
                  <p className="text-white font-semibold">You</p>
                  <p className="text-white/60 text-sm capitalize">
                    {playerColor}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
            <CapturedPieces
              capturedPieces={capturedPieces}
              color={playerColor}
            />
          </div>

          <MoveHistory
            moves={moves}
            currentMoveIndex={currentMoveIndex}
            onMoveClick={() => { }}
          />
        </div>
      </div>

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