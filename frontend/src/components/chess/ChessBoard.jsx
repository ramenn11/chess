import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "../../styles/Board.css";
import RatingChangeDisplay from "./RatingChangeDisplay";
import Square from "./Square"; // Import the extracted component

function ChessBoard({ gameState, onMove, isSpectator, playerColor, getValidMoves }) {
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [pieceSet, setPieceSet] = useState('cburnett');
  const [boardTheme, setBoardTheme] = useState('brown');
  const boardRef = useRef(null);

  const files = playerColor === "black"
    ? ["h", "g", "f", "e", "d", "c", "b", "a"]
    : ["a", "b", "c", "d", "e", "f", "g", "h"];

  const ranks = playerColor === "black"
    ? [1, 2, 3, 4, 5, 6, 7, 8]
    : [8, 7, 6, 5, 4, 3, 2, 1];

  useEffect(() => {
    if (gameState?.lastMove) setLastMove(gameState.lastMove);
  }, [gameState]);

  const handleSquareClick = useCallback((file, rank) => {
    if (isSpectator || gameState?.status !== 'ongoing') return;
    const square = `${file}${rank}`;
    const piece = gameState?.board?.[square];

    if (selectedSquare) {
      if (validMoves.includes(square)) {
        onMove(selectedSquare, square);
        setSelectedSquare(null);
        setValidMoves([]);
      } else if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        setValidMoves(getValidMoves ? getValidMoves(square) : []);
      } else {
        setSelectedSquare(null);
        setValidMoves([]);
      }
    } else {
      if (piece && piece.color === playerColor && gameState.turn === playerColor) {
        setSelectedSquare(square);
        setValidMoves(getValidMoves ? getValidMoves(square) : []);
      }
    }
  }, [isSpectator, gameState, selectedSquare, validMoves, playerColor, getValidMoves, onMove]);

  const handleDragStart = useCallback((square, piece) => {
    if (piece.color === playerColor && gameState.turn === playerColor) {
      setSelectedSquare(square);
      setValidMoves(getValidMoves ? getValidMoves(square) : []);
    }
  }, [playerColor, gameState?.turn, getValidMoves]);

  const handleDragEnd = useCallback((event, sourceSquare) => {
    if (!boardRef.current) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const squareSize = boardRect.width / 8;

    // Support for both mouse and touch end coordinates
    const clientX = event.clientX ?? (event.changedTouches ? event.changedTouches[0].clientX : 0);
    const clientY = event.clientY ?? (event.changedTouches ? event.changedTouches[0].clientY : 0);

    const dropX = clientX - boardRect.left;
    const dropY = clientY - boardRect.top;

    const dropFileIdx = Math.floor(dropX / squareSize);
    const dropRankIdx = Math.floor(dropY / squareSize);

    if (dropFileIdx >= 0 && dropFileIdx < 8 && dropRankIdx >= 0 && dropRankIdx < 8) {
      const targetFile = files[dropFileIdx];
      const targetRank = ranks[dropRankIdx];
      const targetSquare = `${targetFile}${targetRank}`;

      if (validMoves.includes(targetSquare)) {
        onMove(sourceSquare, targetSquare);
      }
    }

    setSelectedSquare(null);
    setValidMoves([]);
  }, [files, ranks, validMoves, onMove]);

  const getPieceAtSquare = (file, rank) => gameState?.board?.[`${file}${rank}`] || null;
  const isSquareHighlighted = (file, rank) => validMoves.includes(`${file}${rank}`);
  const isSquareSelected = (file, rank) => selectedSquare === `${file}${rank}`;
  const isSquareLastMove = (file, rank) => lastMove?.from === `${file}${rank}` || lastMove?.to === `${file}${rank}`;
  const isSquareInCheck = (file, rank) => {
    const piece = getPieceAtSquare(file, rank);
    return piece?.type === "king" && gameState?.check === piece.color;
  };

  const getPieceImage = useCallback((piece) => {
    const colorCode = piece.color === 'white' ? 'w' : 'b';
    const typeMap = { 'pawn': 'P', 'knight': 'N', 'bishop': 'B', 'rook': 'R', 'queen': 'Q', 'king': 'K' };
    return `/assets/pieces/${pieceSet}/${colorCode}${typeMap[piece.type]}.svg`;
  }, [pieceSet]);

  return (
    <div className="chess-board-container" ref={boardRef}>
      <div className="chess-board-wrapper">
        <div
          className="chess-board"
          style={{ backgroundImage: `url(/assets/board/${boardTheme}.svg)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          {ranks.map((rank, rankIdx) =>
            files.map((file, fileIdx) => (
              <Square
                key={`${file}${rank}`}
                file={file}
                rank={rank}
                isLight={(rankIdx + fileIdx) % 2 === 0}
                piece={getPieceAtSquare(file, rank)}
                isSelected={isSquareSelected(file, rank)}
                isHighlighted={isSquareHighlighted(file, rank)}
                isLastMove={isSquareLastMove(file, rank)}
                isInCheck={isSquareInCheck(file, rank)}
                isSpectator={isSpectator}
                getPieceImage={getPieceImage}
                playerColor={playerColor}
                isPlayerTurn={gameState?.turn === playerColor}
                onSquareClick={handleSquareClick}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            ))
          )}
        </div>

        {/* Restored Game Over Overlay */}
        {gameState?.status && gameState.status !== "ongoing" && (
          <motion.div
            className="game-over-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="game-over-card"
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <h2 className="game-over-title">
                {gameState.status === "checkmate" && "Checkmate!"}
                {gameState.status === "stalemate" && "Stalemate!"}
                {gameState.status === "draw" && "Draw!"}
                {gameState.status === "resignation" && "Game Over"}
                {gameState.status === "completed" && "Game Over"}
              </h2>
              <p className="game-over-result">
                {gameState.winner
                  ? `${gameState.winner === "white" ? "White" : "Black"} wins!`
                  : "Game ended in a draw"}
              </p>

              {gameState.ratingChanges && <RatingChangeDisplay />}
            </motion.div>
          </motion.div>
        )}
      </div>

      {/* Restored Theme Selector */}
      <div
        className="fixed bottom-6 right-6 z-50 bg-slate-800/90 backdrop-blur-lg border border-white/20 rounded-xl p-4 shadow-2xl"
        style={{ maxWidth: '200px' }}
      >
        <h4 className="text-white text-sm font-semibold mb-2">Board Theme</h4>
        <select
          value={boardTheme}
          onChange={(e) => setBoardTheme(e.target.value)}
          className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2 mb-2"
        >
          <option value="brown">Brown</option>
          <option value="blue">Blue</option>
          <option value="green">Green</option>
        </select>

        <h4 className="text-white text-sm font-semibold mb-2">Piece Set</h4>
        <select
          value={pieceSet}
          onChange={(e) => setPieceSet(e.target.value)}
          className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2"
        >
          <option value="cburnett">Classic</option>
          <option value="alpha">Alpha</option>
        </select>
      </div>
    </div>
  );
}

export default ChessBoard;