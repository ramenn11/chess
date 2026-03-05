import React, { useState, useEffect } from 'react';

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

  useEffect(() => {
    setTimeLeft(initialTime);
  }, [initialTime]);

  useEffect(() => {
    if (!isActive || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 100));
    }, 100);

    return () => clearInterval(timer);
  }, [isActive, timeLeft]);

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
