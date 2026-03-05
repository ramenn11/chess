import React, { useState } from 'react';
import { Flag, Handshake, RotateCcw, Settings, AlertTriangle, X, Check } from 'lucide-react';

function GameControls({
  isSpectator,
  onResign,
  onOfferDraw,
  onRequestTakeback,
  gameStatus,
  drawOffered = false,
  drawOfferReceived = false,
  onAcceptDraw,
  onDeclineDraw,
  onOpenSettings,
}) {
  const [showConfirmResign, setShowConfirmResign] = useState(false);
  const [drawOfferSent, setDrawOfferSent] = useState(drawOffered);

  const handleResign = () => {
    if (showConfirmResign) {
      onResign();
      setShowConfirmResign(false);
    } else {
      setShowConfirmResign(true);
      setTimeout(() => setShowConfirmResign(false), 3000);
    }
  };

  const handleOfferDraw = () => {
    setDrawOfferSent(true);
    onOfferDraw();
    setTimeout(() => setDrawOfferSent(false), 5000);
  };

  if (isSpectator || gameStatus !== 'ongoing') {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Draw Offer Received - Compact Priority Display */}
      {drawOfferReceived && (
        <div className="bg-green-500/20 border border-green-500/50 rounded-md p-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-green-400" />
            <span className="text-white text-sm font-medium">Draw Offer</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={onDeclineDraw}
              className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-all"
              title="Decline"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={onAcceptDraw}
              className="p-1.5 rounded bg-green-600 hover:bg-green-700 text-white transition-all"
              title="Accept"
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Icon Controls Row */}
      <div className="flex items-center justify-center gap-1 bg-white/5 rounded-md p-1.5">
        <button
          onClick={handleResign}
          className={`p-2 rounded transition-all ${showConfirmResign
            ? 'bg-red-600 text-white animate-pulse'
            : 'hover:bg-white/10 text-white/70 hover:text-white'
            }`}
          title={showConfirmResign ? 'Click again to confirm' : 'Resign'}
        >
          <Flag className="w-4 h-4" />
        </button>

        <button
          onClick={handleOfferDraw}
          disabled={drawOfferSent}
          className={`p-2 rounded transition-all ${drawOfferSent
            ? 'text-green-400 cursor-not-allowed'
            : 'hover:bg-white/10 text-white/70 hover:text-white'
            }`}
          title={drawOfferSent ? 'Draw offered' : 'Offer draw'}
        >
          <Handshake className="w-4 h-4" />
        </button>

        <button
          onClick={onRequestTakeback}
          className="p-2 rounded hover:bg-white/10 text-white/70 hover:text-white transition-all"
          title="Request takeback"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-white/20 mx-1" />

        <button
          onClick={onOpenSettings}
          className="p-2 rounded hover:bg-white/10 text-white/70 hover:text-white transition-all"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default GameControls;