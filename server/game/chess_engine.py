class ChessEngine:
    def __init__(self, fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'):
        self.board = {}
        self.turn = 'white'
        self.castling = {'K': True, 'Q': True, 'k': True, 'q': True}
        self.en_passant = None
        self.half_moves = 0
        self.full_moves = 1
        self.load_fen(fen)
    
    def load_fen(self, fen):
        parts = fen.split(' ')
        position = parts[0]
        
        self.board = {}
        ranks = position.split('/')
        
        for rank_idx, rank in enumerate(ranks):
            file_idx = 0
            for char in rank:
                if char.isdigit():
                    file_idx += int(char)
                else:
                    square = self.coord_to_square(file_idx, 7 - rank_idx)
                    self.board[square] = self.parse_piece(char)
                    file_idx += 1
        
        self.turn = 'white' if parts[1] == 'w' else 'black'
        
        castling_str = parts[2]
        self.castling = {
            'K': 'K' in castling_str,
            'Q': 'Q' in castling_str,
            'k': 'k' in castling_str,
            'q': 'q' in castling_str
        }
        
        self.en_passant = parts[3] if parts[3] != '-' else None
        self.half_moves = int(parts[4])
        self.full_moves = int(parts[5])
    
    def parse_piece(self, char):
        is_white = char.isupper()
        piece_map = {
            'p': 'pawn', 'n': 'knight', 'b': 'bishop',
            'r': 'rook', 'q': 'queen', 'k': 'king'
        }
        return {
            'type': piece_map[char.lower()],
            'color': 'white' if is_white else 'black'
        }
    
    def coord_to_square(self, file, rank):
        files = 'abcdefgh'
        return f"{files[file]}{rank + 1}"
    
    def square_to_coord(self, square):
        files = 'abcdefgh'
        return files.index(square[0]), int(square[1]) - 1
    
    def is_valid_move(self, from_sq, to_sq, promotion=None):
        """Validate if a move is legal"""
        piece = self.board.get(from_sq)
        if not piece or piece['color'] != self.turn:
            return False
        
        moves = self.get_piece_moves(from_sq)
        if to_sq not in moves:
            return False
        
        # CRITICAL: Check if move leaves king in check
        # We need to simulate the move and check if OUR king is attacked
        test_board = self.copy()
        test_board.make_move_unsafe(from_sq, to_sq, promotion)
        
        # Find OUR king (the player making the move)
        king_sq = test_board.find_king(self.turn)
        if not king_sq:
            return False
        
        # Check if OUR king is attacked after the move
        if test_board.is_square_attacked(king_sq, self.turn):
            return False
        
        return True
    
    def make_move(self, from_sq, to_sq, promotion=None):
        """
        Make a move and return game state info
        CRITICAL FIX: Proper turn management and game state checking
        """
        # Capture info BEFORE move
        moving_piece = self.board[from_sq]
        moving_color = moving_piece['color']  # Save who's moving
        captured_piece_obj = self.board.get(to_sq)
        captured_type = captured_piece_obj['type'] if captured_piece_obj else ''
        
        # Execute move (this will update board and switch turn)
        self.make_move_unsafe(from_sq, to_sq, promotion)
        
        # AFTER move, the turn has switched to opponent
        # So we need to check if OPPONENT is in check/checkmate/stalemate
        opponent_color = self.turn  # Current turn is now the opponent
        
        is_check = self.is_in_check(opponent_color)
        is_checkmate = is_check and self.is_checkmate(opponent_color)
        is_stalemate = not is_check and self.is_stalemate(opponent_color)
        
        # Determine game status
        status = 'ongoing'
        winner = None
        
        if is_checkmate:
            status = 'checkmate'
            winner = moving_color  # Player who just moved wins
        elif is_stalemate:
            status = 'stalemate'
            winner = None
        
        return {
            'fen': self.to_fen(),
            'piece': moving_piece['type'],
            'captured': captured_type,
            'notation': self.to_algebraic(from_sq, to_sq, moving_piece, captured_piece_obj, promotion),
            'is_check': is_check,
            'is_checkmate': is_checkmate,
            'status': status,
            'winner': winner
        }
    
    def make_move_unsafe(self, from_sq, to_sq, promotion=None):
        """
        Execute move without validation
        Updates board state and switches turn
        """
        # FIX: Create a COPY of the piece dictionary
        piece = self.board[from_sq].copy()
        
        # Handle promotion
        if promotion and piece['type'] == 'pawn':
            piece['type'] = promotion
        
        # Handle castling - move rook
        if piece['type'] == 'king':
            from_file, from_rank = self.square_to_coord(from_sq)
            to_file, to_rank = self.square_to_coord(to_sq)
            
            if abs(to_file - from_file) == 2:
                # Kingside
                if to_file > from_file:
                    rook_from = self.coord_to_square(7, from_rank)
                    rook_to = self.coord_to_square(5, from_rank)
                # Queenside
                else:
                    rook_from = self.coord_to_square(0, from_rank)
                    rook_to = self.coord_to_square(3, from_rank)
                
                # FIX: Copy the rook too
                rook = self.board[rook_from].copy()
                del self.board[rook_from]
                self.board[rook_to] = rook
            
            # Update castling rights when king moves
            if piece['color'] == 'white':
                self.castling['K'] = False
                self.castling['Q'] = False
            else:
                self.castling['k'] = False
                self.castling['q'] = False
        
        # Handle en passant capture
        if piece['type'] == 'pawn' and to_sq == self.en_passant:
            # Remove the captured pawn
            capture_rank = 4 if piece['color'] == 'white' else 3
            capture_sq = f"{to_sq[0]}{capture_rank + 1}"
            if capture_sq in self.board:
                del self.board[capture_sq]
        
        # Update en passant square for next move
        self.en_passant = None
        if piece['type'] == 'pawn':
            from_file, from_rank = self.square_to_coord(from_sq)
            to_file, to_rank = self.square_to_coord(to_sq)
            
            # Double pawn push sets en passant
            if abs(to_rank - from_rank) == 2:
                ep_rank = (from_rank + to_rank) // 2
                self.en_passant = self.coord_to_square(from_file, ep_rank)
        
        # Update castling rights if rook moves
        if piece['type'] == 'rook':
            if from_sq == 'a1': self.castling['Q'] = False
            if from_sq == 'h1': self.castling['K'] = False
            if from_sq == 'a8': self.castling['q'] = False
            if from_sq == 'h8': self.castling['k'] = False
        
        # FIX: Capture before moving (need for return value)
        captured = self.board.get(to_sq)
        
        # Make the move
        self.board[to_sq] = piece
        del self.board[from_sq]
        
        # Switch turn
        self.turn = 'black' if self.turn == 'white' else 'white'
        
        # Update move counters
        if piece['type'] == 'pawn' or captured:
            self.half_moves = 0
        else:
            self.half_moves += 1
        
        if self.turn == 'white':
            self.full_moves += 1
        
        return captured
    
    def get_piece_moves(self, square):
        """Get all pseudo-legal moves for a piece (doesn't check if king is in check)"""
        piece = self.board.get(square)
        if not piece:
            return []
        
        move_funcs = {
            'pawn': self.get_pawn_moves,
            'knight': self.get_knight_moves,
            'bishop': self.get_bishop_moves,
            'rook': self.get_rook_moves,
            'queen': self.get_queen_moves,
            'king': self.get_king_moves
        }
        
        return move_funcs[piece['type']](square, piece['color'])
    
    def get_pawn_moves(self, square, color):
        moves = []
        file, rank = self.square_to_coord(square)
        direction = 1 if color == 'white' else -1
        start_rank = 1 if color == 'white' else 6
        
        # Forward move
        forward_rank = rank + direction
        if 0 <= forward_rank < 8:
            forward_sq = self.coord_to_square(file, forward_rank)
            if forward_sq not in self.board:
                moves.append(forward_sq)
                
                # Double push from starting position
                if rank == start_rank:
                    double_rank = rank + 2 * direction
                    double_sq = self.coord_to_square(file, double_rank)
                    if double_sq not in self.board:
                        moves.append(double_sq)
        
        # Captures
        for file_delta in [-1, 1]:
            new_file = file + file_delta
            if 0 <= new_file < 8:
                capture_rank = rank + direction
                if 0 <= capture_rank < 8:
                    capture_sq = self.coord_to_square(new_file, capture_rank)
                    target = self.board.get(capture_sq)
                    
                    # Regular capture
                    if target and target['color'] != color:
                        moves.append(capture_sq)
                    
                    # En passant
                    if capture_sq == self.en_passant:
                        moves.append(capture_sq)
        
        return moves
    
    def get_knight_moves(self, square, color):
        moves = []
        file, rank = self.square_to_coord(square)
        deltas = [(2,1), (2,-1), (-2,1), (-2,-1), (1,2), (1,-2), (-1,2), (-1,-2)]
        
        for df, dr in deltas:
            new_file, new_rank = file + df, rank + dr
            if 0 <= new_file < 8 and 0 <= new_rank < 8:
                target_sq = self.coord_to_square(new_file, new_rank)
                target = self.board.get(target_sq)
                if not target or target['color'] != color:
                    moves.append(target_sq)
        
        return moves
    
    def get_sliding_moves(self, square, color, directions):
        moves = []
        file, rank = self.square_to_coord(square)
        
        for df, dr in directions:
            new_file, new_rank = file + df, rank + dr
            
            while 0 <= new_file < 8 and 0 <= new_rank < 8:
                target_sq = self.coord_to_square(new_file, new_rank)
                target = self.board.get(target_sq)
                
                if not target:
                    moves.append(target_sq)
                else:
                    if target['color'] != color:
                        moves.append(target_sq)
                    break
                
                new_file += df
                new_rank += dr
        
        return moves
    
    def get_bishop_moves(self, square, color):
        return self.get_sliding_moves(square, color, [(1,1), (1,-1), (-1,1), (-1,-1)])
    
    def get_rook_moves(self, square, color):
        return self.get_sliding_moves(square, color, [(1,0), (-1,0), (0,1), (0,-1)])
    
    def get_queen_moves(self, square, color):
        return self.get_sliding_moves(square, color, [
            (1,1), (1,-1), (-1,1), (-1,-1),
            (1,0), (-1,0), (0,1), (0,-1)
        ])
    
    def get_king_moves(self, square, color):
        """Get king moves including castling"""
        moves = []
        file, rank = self.square_to_coord(square)
        
        # Normal king moves (one square in any direction)
        for df in [-1, 0, 1]:
            for dr in [-1, 0, 1]:
                if df == 0 and dr == 0:
                    continue
                
                new_file, new_rank = file + df, rank + dr
                if 0 <= new_file < 8 and 0 <= new_rank < 8:
                    target_sq = self.coord_to_square(new_file, new_rank)
                    target = self.board.get(target_sq)
                    if not target or target['color'] != color:
                        moves.append(target_sq)
        
        # Castling - only check if king is not in check
        if not self.is_square_attacked(square, color):
            start_rank = 0 if color == 'white' else 7
            
            # Kingside castling
            if (color == 'white' and self.castling['K']) or (color == 'black' and self.castling['k']):
                f_sq = self.coord_to_square(5, start_rank)
                g_sq = self.coord_to_square(6, start_rank)
                
                # Check squares are empty and not attacked
                if (f_sq not in self.board and g_sq not in self.board and
                    not self.is_square_attacked(f_sq, color) and
                    not self.is_square_attacked(g_sq, color)):
                    moves.append(g_sq)
            
            # Queenside castling
            if (color == 'white' and self.castling['Q']) or (color == 'black' and self.castling['q']):
                d_sq = self.coord_to_square(3, start_rank)
                c_sq = self.coord_to_square(2, start_rank)
                b_sq = self.coord_to_square(1, start_rank)
                
                # Check squares are empty and not attacked
                if (d_sq not in self.board and c_sq not in self.board and b_sq not in self.board and
                    not self.is_square_attacked(d_sq, color) and
                    not self.is_square_attacked(c_sq, color)):
                    moves.append(c_sq)
        
        return moves
    
    def get_king_moves_simple(self, square, color):
        """
        King moves WITHOUT castling check
        Used in is_square_attacked to prevent infinite recursion
        """
        moves = []
        file, rank = self.square_to_coord(square)
        
        for df in [-1, 0, 1]:
            for dr in [-1, 0, 1]:
                if df == 0 and dr == 0:
                    continue
                
                new_file, new_rank = file + df, rank + dr
                if 0 <= new_file < 8 and 0 <= new_rank < 8:
                    target_sq = self.coord_to_square(new_file, new_rank)
                    target = self.board.get(target_sq)
                    if not target or target['color'] != color:
                        moves.append(target_sq)
        
        return moves
    
    def is_square_attacked(self, square, defender_color):
        """
        Check if a square is attacked by opponent
        CRITICAL: Uses simple king moves to avoid recursion
        """
        attacker_color = 'black' if defender_color == 'white' else 'white'
        
        for sq, piece in self.board.items():
            if piece['color'] == attacker_color:
                # For kings, use simple moves (no castling check)
                if piece['type'] == 'king':
                    moves = self.get_king_moves_simple(sq, piece['color'])
                else:
                    moves = self.get_piece_moves(sq)
                
                if square in moves:
                    return True
        
        return False
    
    def find_king(self, color):
        """Find king position for given color"""
        for square, piece in self.board.items():
            if piece['type'] == 'king' and piece['color'] == color:
                return square
        return None
    
    def is_in_check(self, color):
        """Check if king of given color is in check"""
        king_sq = self.find_king(color)
        if not king_sq:
            return False
        return self.is_square_attacked(king_sq, color)
    
    def is_checkmate(self, color):
        """Check if given color is checkmated"""
        if not self.is_in_check(color):
            return False
        
        # Try all possible moves to see if any gets out of check
        for square, piece in self.board.items():
            if piece['color'] == color:
                moves = self.get_piece_moves(square)
                for move in moves:
                    # Simulate move
                    test_board = self.copy()
                    test_board.make_move_unsafe(square, move, None)
                    
                    # Check if king is still in check after move
                    # CRITICAL: Since turn switched, we need to check the PREVIOUS color
                    king_sq = test_board.find_king(color)
                    if not test_board.is_square_attacked(king_sq, color):
                        return False  # Found a legal move
        
        return True  # No legal moves found
    
    def is_stalemate(self, color):
        """
        Check if given color is stalemated
        CRITICAL FIX: Ensure we're checking the right conditions
        """
        # Stalemate only if NOT in check
        if self.is_in_check(color):
            return False
        
        # Check if player has any legal moves
        for square, piece in self.board.items():
            if piece['color'] == color:
                moves = self.get_piece_moves(square)
                for move in moves:
                    # Test if move is legal (doesn't leave king in check)
                    test_board = self.copy()
                    
                    # CRITICAL: Save color before move
                    moving_color = color
                    test_board.make_move_unsafe(square, move, None)
                    
                    # Check if OUR king is safe after the move
                    king_sq = test_board.find_king(moving_color)
                    if not test_board.is_square_attacked(king_sq, moving_color):
                        return False  # Found a legal move
        
        return True  # No legal moves and not in check = stalemate
    
    def to_fen(self):
        """Convert board to FEN string"""
        fen = ''
        
        for rank in range(7, -1, -1):
            empty = 0
            for file in range(8):
                square = self.coord_to_square(file, rank)
                piece = self.board.get(square)
                
                if piece:
                    if empty > 0:
                        fen += str(empty)
                        empty = 0
                    fen += self.piece_to_char(piece)
                else:
                    empty += 1
            
            if empty > 0:
                fen += str(empty)
            if rank > 0:
                fen += '/'
        
        fen += f" {'w' if self.turn == 'white' else 'b'}"
        
        castling = ''
        if self.castling['K']: castling += 'K'
        if self.castling['Q']: castling += 'Q'
        if self.castling['k']: castling += 'k'
        if self.castling['q']: castling += 'q'
        fen += f" {castling or '-'}"
        
        fen += f" {self.en_passant or '-'}"
        fen += f" {self.half_moves} {self.full_moves}"
        
        return fen
    
    def piece_to_char(self, piece):
        chars = {
            'pawn': 'p', 'knight': 'n', 'bishop': 'b',
            'rook': 'r', 'queen': 'q', 'king': 'k'
        }
        char = chars[piece['type']]
        return char.upper() if piece['color'] == 'white' else char
    
    def to_algebraic(self, from_sq, to_sq, piece, captured, promotion):
        """Convert move to algebraic notation"""
        notation = ''
        
        # Castling
        if piece['type'] == 'king' and abs(ord(from_sq[0]) - ord(to_sq[0])) == 2:
            return 'O-O' if ord(to_sq[0]) > ord(from_sq[0]) else 'O-O-O'
        
        # Piece prefix (except pawns)
        if piece['type'] != 'pawn':
            notation += piece['type'][0].upper()
        
        # Capture notation
        if captured:
            if piece['type'] == 'pawn':
                notation += from_sq[0]  # File of origin for pawn captures
            notation += 'x'
        
        notation += to_sq
        
        # Promotion
        if promotion:
            notation += '=' + promotion[0].upper()
        
        return notation
    
    def copy(self):
        """Create a deep copy of the engine"""
        new_engine = ChessEngine()
        
        # Deep copy each piece dictionary
        new_engine.board = {k: v.copy() for k, v in self.board.items()}
        new_engine.turn = self.turn
        new_engine.castling = self.castling.copy()
        new_engine.en_passant = self.en_passant
        new_engine.half_moves = self.half_moves
        new_engine.full_moves = self.full_moves
        
        return new_engine

    def play_uci_move(self, uci_move):
        """
        Parses a UCI string (e.g., 'e2e4' or 'e7e8q') and executes it.
        Returns the move result dictionary if valid, or False if invalid.
        """
        if len(uci_move) < 4:
            return False
            
        from_sq = uci_move[:2]
        to_sq = uci_move[2:4]
        promotion = uci_move[4:] if len(uci_move) == 5 else None
        
        # Translate promotion character to piece type for engine
        promo_map = {'q': 'queen', 'r': 'rook', 'b': 'bishop', 'n': 'knight'}
        if promotion and promotion in promo_map:
            promotion = promo_map[promotion]
            
        if self.is_valid_move(from_sq, to_sq, promotion):
            return self.make_move(from_sq, to_sq, promotion)
            
        return False

    @classmethod
    def from_move_list(cls, move_list, initial_fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'):
        """
        Utility to completely reconstruct a game state from a list of UCI moves.
        Perfect for spectators joining mid-game or actor crash recovery.
        """
        engine = cls(fen=initial_fen)
        
        for uci in move_list:
            result = engine.play_uci_move(uci)
            if not result:
                raise ValueError(f"Invalid move '{uci}' found in move history.")
                
        return engine

    def get_legal_uci_moves(self, color):
        """
        Generates a list of all legal UCI moves for the given color.
        """
        legal_moves = []
        for square, piece in self.board.items():
            if piece['color'] == color:
                moves = self.get_piece_moves(square)
                for to_sq in moves:
                    # Simulate move to ensure it doesn't leave king in check
                    test_board = self.copy()
                    test_board.make_move_unsafe(square, to_sq, None)
                    king_sq = test_board.find_king(color)
                    
                    if not test_board.is_square_attacked(king_sq, color):
                        # Handle basic UCI formatting
                        legal_moves.append(f"{square}{to_sq}")
                        
                        # Add promotion variations if it's a pawn reaching the end
                        if piece['type'] == 'pawn':
                            rank = int(to_sq[1])
                            if (color == 'white' and rank == 8) or (color == 'black' and rank == 1):
                                legal_moves.remove(f"{square}{to_sq}") # Remove the unpromoted move
                                legal_moves.extend([f"{square}{to_sq}q", f"{square}{to_sq}r", f"{square}{to_sq}b", f"{square}{to_sq}n"])
                                
        return legal_moves