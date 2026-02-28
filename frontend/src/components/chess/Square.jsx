import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// React.memo prevents re-renders unless the specific props for THIS square change
const Square = memo(({
    file, rank, isLight, piece, isSelected, isHighlighted,
    isLastMove, isInCheck, isSpectator, getPieceImage,
    playerColor, isPlayerTurn, onSquareClick, onDragStart, onDragEnd
}) => {
    const squareId = `${file}${rank}`;
    const hasPieceOnValidMove = isHighlighted && piece;

    return (
        <div
            className={`
        chess-square relative w-full h-full flex items-center justify-center
        ${isLight ? 'bg-[#f0d9b5]' : 'bg-[#b58863]'}
        ${isSelected ? 'ring-inset ring-4 ring-yellow-400 bg-yellow-400/50' : ''}
        ${isLastMove ? 'bg-yellow-400/30' : ''}
        ${isInCheck ? 'bg-red-500/80 animate-pulse' : ''}
      `}
            onClick={() => onSquareClick(file, rank)}
        >
            {/* Valid Move Indicators */}
            {isHighlighted && !piece && (
                <div className="absolute w-[30%] h-[30%] bg-black/20 rounded-full z-10 pointer-events-none" />
            )}
            {hasPieceOnValidMove && (
                <div className="absolute inset-0 border-4 border-black/20 rounded-full z-10 pointer-events-none" />
            )}

            {/* Piece Rendering with Framer Motion */}
            <AnimatePresence>
                {piece && (
                    <motion.div
                        key={`${squareId}-${piece.type}-${piece.color}`}
                        className="absolute w-[85%] h-[85%] z-20 cursor-grab active:cursor-grabbing"
                        initial={false}
                        // Only allow dragging if it's the player's turn and their piece
                        drag={!isSpectator && piece.color === playerColor && isPlayerTurn}
                        dragSnapToOrigin={true}
                        dragElastic={0}
                        whileDrag={{ scale: 1.2, zIndex: 50, filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))' }}
                        onDragStart={() => onDragStart(squareId, piece)}
                        onDragEnd={(event, info) => onDragEnd(event, squareId)}
                        layoutId={`piece-${piece.type}-${piece.color}-${squareId}`} // Enables smooth piece sliding
                    >
                        <img
                            src={getPieceImage(piece)}
                            alt={`${piece.color} ${piece.type}`}
                            className="w-full h-full object-contain pointer-events-none select-none"
                            draggable={false}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Coordinates */}
            {file === 'a' && <span className="absolute left-1 top-1 text-[10px] font-bold z-10 mix-blend-overlay opacity-70">{rank}</span>}
            {rank === 1 && <span className="absolute right-1 bottom-1 text-[10px] font-bold z-10 mix-blend-overlay opacity-70">{file}</span>}
        </div>
    );
});

Square.displayName = 'Square';
export default Square;