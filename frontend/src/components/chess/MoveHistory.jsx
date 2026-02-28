// frontend/src/components/chess/MoveHistory.jsx
import React, { useRef, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

function MoveHistory({ moves, currentMoveIndex, onMoveClick }) {
  const virtuosoRef = useRef(null);

  // Group moves into pairs [white, black]
  const movePairs = moves.reduce((result, value, index, array) => {
    if (index % 2 === 0) result.push(array.slice(index, index + 2));
    return result;
  }, []);

  // Track the active move and tell Virtuoso to scroll to it
  useEffect(() => {
    if (virtuosoRef.current && currentMoveIndex >= 0) {
      const pairIndex = Math.floor(currentMoveIndex / 2);
      virtuosoRef.current.scrollToIndex({
        index: pairIndex,
        align: 'center',
        behavior: 'smooth'
      });
    }
  }, [currentMoveIndex]);

  const handleFirst = () => { if (moves.length > 0) onMoveClick(0); };
  const handlePrev = () => { if (currentMoveIndex > 0) onMoveClick(currentMoveIndex - 1); };
  const handleNext = () => { if (currentMoveIndex < moves.length - 1) onMoveClick(currentMoveIndex + 1); };
  const handleLast = () => { if (moves.length > 0) onMoveClick(moves.length - 1); };

  const formatMove = (move) => {
    if (move.notation) return move.notation;
    return `${move.from}-${move.to}`;
  };

  return (
    <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 flex flex-col h-full w-full overflow-hidden">
      <div className="p-3 border-b border-white/10 font-semibold text-white shrink-0">
        Move History
      </div>

      {/* Virtuoso strictly bounded within the flex container */}
      <div className="flex-1 min-h-0 relative">
        {movePairs.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No moves yet</p>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="h-full w-full custom-scrollbar absolute inset-0"
            data={movePairs}
            initialTopMostItemIndex={movePairs.length - 1} // Auto-scroll to bottom initially
            itemContent={(index, pair) => (
              <div className="grid grid-cols-[40px_1fr_1fr] gap-2 text-sm px-4 py-1 hover:bg-white/5 transition-colors">
                <span className="text-white/40 font-semibold self-center">{index + 1}.</span>

                <button
                  onClick={() => onMoveClick(index * 2)}
                  className={`text-left px-2 py-1 rounded transition-colors ${currentMoveIndex === index * 2
                      ? 'bg-purple-600/50 text-white font-semibold ring-2 ring-purple-400'
                      : 'text-white/80 hover:bg-white/10'
                    }`}
                >
                  {formatMove(pair[0])}
                </button>

                {pair[1] ? (
                  <button
                    onClick={() => onMoveClick(index * 2 + 1)}
                    className={`text-left px-2 py-1 rounded transition-colors ${currentMoveIndex === index * 2 + 1
                        ? 'bg-purple-600/50 text-white font-semibold ring-2 ring-purple-400'
                        : 'text-white/80 hover:bg-white/10'
                      }`}
                  >
                    {formatMove(pair[1])}
                  </button>
                ) : (
                  <div />
                )}
              </div>
            )}
          />
        )}
      </div>

      {/* Navigation Buttons and Position */}
      <div className="mt-auto shrink-0 border-t border-white/10 bg-white/5">
        {moves.length > 0 && (
          <div className="grid grid-cols-4 gap-2 p-3 pb-1">
            <button onClick={handleFirst} disabled={currentMoveIndex <= 0} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="First move">
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button onClick={handlePrev} disabled={currentMoveIndex <= 0} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Previous move">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={handleNext} disabled={currentMoveIndex >= moves.length - 1} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Next move">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={handleLast} disabled={currentMoveIndex >= moves.length - 1} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Last move">
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Restored current position indicator */}
        {moves.length > 0 && (
          <div className="text-center text-white/60 text-xs pb-3 mt-2">
            Position: {currentMoveIndex >= 0 ? currentMoveIndex + 1 : 0} / {moves.length}
          </div>
        )}
      </div>
    </div>
  );
}

export default MoveHistory;