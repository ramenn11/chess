import React, { useState, useEffect, useRef } from 'react';

function CompactPlayerClock({
  initialTime,
  increment,
  isActive,
  color,
  playerName,
  playerRating,
  isTop = false
}) {
  const [timeLeft, setTimeLeft] = useState(initialTime);

  // Track the exact timestamp when the clock started/updated
  const lastUpdateRef = useRef(Date.now());
  // Track the exact time remaining at that moment
  const baseTimeRef = useRef(initialTime);

  // Sync state when the server pushes a new initialTime (e.g., after a move)
  useEffect(() => {
    setTimeLeft(initialTime);
    baseTimeRef.current = initialTime;
    lastUpdateRef.current = Date.now();
  }, [initialTime]);

  // Handle the active countdown using real elapsed time
  useEffect(() => {
    if (!isActive || timeLeft <= 0) return;

    // Reset our reference points exactly when the clock becomes active
    baseTimeRef.current = timeLeft;
    lastUpdateRef.current = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastUpdateRef.current;
      const newTimeLeft = Math.max(0, baseTimeRef.current - elapsed);

      setTimeLeft(newTimeLeft);

      if (newTimeLeft <= 0) {
        clearInterval(timer);
      }
    }, 50); // Lowered to 50ms for much smoother visual rendering on deciseconds

    return () => clearInterval(timer);
  }, [isActive]); // Note: timeLeft is NO LONGER a dependency!

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const deciseconds = Math.floor((ms % 1000) / 100);

    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${seconds}.${deciseconds}`;
  };

  const isLowTime = timeLeft < 20000;
  const isCriticalTime = timeLeft < 10000;
  const isTimeout = timeLeft === 0;

  const bgColor = color === 'white' ? 'bg-white' : 'bg-gray-800';
  const textColor = color === 'white' ? 'text-gray-900' : 'text-white';
  const activeBorder = isActive ? 'ring-2 ring-green-500' : '';
  const timeColor = isTimeout ? 'text-red-600' : isCriticalTime ? 'text-red-500' : isLowTime ? 'text-orange-500' : textColor;

  return (
    <div className={`flex items-center justify-between ${bgColor} ${textColor} rounded-md px-3 py-2 ${activeBorder} transition-all`}>
      <div className="flex items-center gap-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${color === 'white' ? 'bg-gray-200' : 'bg-gray-700'}`}>
          {color === 'white' ? '♔' : '♚'}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium truncate max-w-[100px]">{playerName || 'Anonymous'}</span>
          <span className="text-xs opacity-70">{playerRating || '?'}</span>
        </div>
      </div>
      <div className={`text-xl font-bold tabular-nums ${timeColor}`}>
        {formatTime(timeLeft)}
        {increment > 0 && (
          <span className="text-xs font-normal opacity-70 ml-1">+{increment / 1000}</span>
        )}
      </div>
    </div>
  );
}

export default CompactPlayerClock;