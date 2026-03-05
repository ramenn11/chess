// frontend/src/components/chess/MoveHistory.jsx
import React, { useRef, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

function MoveHistory({ moves, currentMoveIndex, onMoveClick, viewingMoveIndex, onReturnToLive }) {
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
  const handlePrev = () => {
    const idx = viewingMoveIndex !== null ? viewingMoveIndex : moves.length - 1;
    if (idx > 0) onMoveClick(idx - 1);
  };
  const handleNext = () => {
    const idx = viewingMoveIndex !== null ? viewingMoveIndex : moves.length - 1;
    if (idx < moves.length - 1) onMoveClick(idx + 1);
  };
  const handleLast = () => {
    if (moves.length > 0) onMoveClick(moves.length - 1);
  };
  const handleLive = () => {
    if (onReturnToLive) onReturnToLive();
  };

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
                  className={`text-left px-2 py-1 rounded transition-colors ${(viewingMoveIndex !== null ? viewingMoveIndex : currentMoveIndex) === index * 2
                    ? 'bg-purple-600/50 text-white font-semibold ring-2 ring-purple-400'
                    : 'text-white/80 hover:bg-white/10'
                    }`}
                >
                  {formatMove(pair[0])}
                </button>

                {pair[1] ? (
                  <button
                    onClick={() => onMoveClick(index * 2 + 1)}
                    className={`text-left px-2 py-1 rounded transition-colors ${(viewingMoveIndex !== null ? viewingMoveIndex : currentMoveIndex) === index * 2 + 1
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

      {/* Navigation Buttons */}
      <div className="mt-auto shrink-0 border-t border-white/10 bg-white/5">
        {moves.length > 0 && (
          <div className="grid grid-cols-5 gap-2 p-3 pb-1">
            <button onClick={handleFirst} disabled={viewingMoveIndex !== null ? viewingMoveIndex <= 0 : currentMoveIndex <= 0} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="First move">
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button onClick={handlePrev} disabled={viewingMoveIndex !== null ? viewingMoveIndex <= 0 : currentMoveIndex <= 0} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Previous move">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={handleNext} disabled={viewingMoveIndex !== null ? viewingMoveIndex >= moves.length - 1 : currentMoveIndex >= moves.length - 1} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Next move">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={handleLast} disabled={viewingMoveIndex !== null ? viewingMoveIndex >= moves.length - 1 : currentMoveIndex >= moves.length - 1} className="flex items-center justify-center p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Last move">
              <ChevronsRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleLive}
              disabled={viewingMoveIndex === null}
              className={`flex items-center justify-center p-2 rounded font-bold text-xs transition-colors ${viewingMoveIndex === null ? 'bg-green-600/50 text-white/50 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
              title="Return to Live"
            >
              LIVE
            </button>
          </div>
        )}

        {/* Position indicator */}
        {moves.length > 0 && (
          <div className="text-center text-white/60 text-xs pb-3 mt-2">
            {viewingMoveIndex !== null ? (
              <span className="text-orange-400">Viewing: Move {viewingMoveIndex + 1} / {moves.length}</span>
            ) : (
              <span className="text-green-400">Live: Move {moves.length} / {moves.length}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MoveHistory;