from dataclasses import dataclass, asdict
from typing import List, Optional
import time

@dataclass
class MoveNode:
    """Represents a single move in memory and over WebSockets"""
    uci: str
    notation: str
    time_spent: int
    time_left: int
    color: str
    timestamp: float

    is_check: bool = False
    captured: bool = False

    def to_dict(self):
        return asdict(self)

@dataclass
class ActiveGameState:
    """The live game state stored in Redis"""
    game_id: str
    white_player_id: str
    black_player_id: str
    white_time_left: int
    black_time_left: int
    increment: int
    last_move_timestamp: float
    current_turn: str
    current_fen: str
    status: str
    moves: List[MoveNode]
    termination: Optional[str] = None

    draw_offer_by: Optional[str] = None
    takeback_request_by: Optional[str] = None

    def add_move(self, move: MoveNode):
        self.moves.append(move)
        self.current_turn = 'black' if self.current_turn == 'white' else 'white'
        self.last_move_timestamp = move.timestamp

    @classmethod
    def from_dict(cls, data: dict):
        moves_data = data.pop('moves', [])
        moves = [MoveNode(**m) for m in moves_data]
        return cls(**data, moves=moves)
        
    def to_dict(self):
        return asdict(self)