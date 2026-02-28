class MoveValidator {
  constructor(board) {
    this.board = board;
  }

  isValidMove(from, to, promotion = null) {
    const piece = this.board.getPiece(from);
    if (!piece || piece.color !== this.board.turn) {
      return false;
    }

    // Prevent capturing king
    const targetPiece = this.board.getPiece(to);
    if (targetPiece && targetPiece.type === 'king') {
      return false;
    }

    const moves = this.getPieceMoves(from);
    if (!moves.includes(to)) {
      return false;
    }

    // 1. IN-PLACE MAKE/UNDO (No more cloning!)
    const history = this.makeMove(this.board, from, to, promotion);

    // Turn was swapped in makeMove, so our color is now history.turn
    const ourColor = history.turn;
    const kingSquare = this.findKing(this.board, ourColor);

    // 2. Fast reverse-lookup to see if the king is attacked
    const isCheck = this.isSquareAttacked(this.board, kingSquare, ourColor);

    // Immediately undo the move to restore the exact board state
    this.undoMove(this.board, history);

    return !isCheck; // If not in check, it's a valid move
  }

  getPieceMoves(square) {
    const piece = this.board.getPiece(square);
    if (!piece) return [];

    const moveFunctions = {
      'pawn': this.getPawnMoves.bind(this),
      'knight': this.getKnightMoves.bind(this),
      'bishop': this.getBishopMoves.bind(this),
      'rook': this.getRookMoves.bind(this),
      'queen': this.getQueenMoves.bind(this),
      'king': this.getKingMoves.bind(this)
    };

    return moveFunctions[piece.type](square, piece.color);
  }

  getPawnMoves(square, color) {
    const moves = [];
    const coord = this.board.squareToCoordinate(square);
    const direction = color === 'white' ? 1 : -1;
    const startRank = color === 'white' ? 1 : 6;

    // Forward move
    const forwardFile = coord.file;
    const forwardRank = coord.rank + direction;
    if (forwardRank >= 0 && forwardRank <= 7) {
      const forwardSquare = this.board.coordToSquare(forwardFile, forwardRank);
      if (!this.board.getPiece(forwardSquare)) {
        moves.push(forwardSquare);

        // Double push from starting position
        if (coord.rank === startRank) {
          const doubleRank = coord.rank + (2 * direction);
          const doubleSquare = this.board.coordToSquare(forwardFile, doubleRank);
          if (!this.board.getPiece(doubleSquare)) {
            moves.push(doubleSquare);
          }
        }
      }
    }

    // Captures
    for (const fileDelta of [-1, 1]) {
      const captureFile = coord.file + fileDelta;
      const captureRank = coord.rank + direction;

      if (captureFile >= 0 && captureFile <= 7 && captureRank >= 0 && captureRank <= 7) {
        const captureSquare = this.board.coordToSquare(captureFile, captureRank);
        const targetPiece = this.board.getPiece(captureSquare);

        if (targetPiece && targetPiece.color !== color) {
          moves.push(captureSquare);
        }

        // En passant
        if (captureSquare === this.board.enPassant) {
          moves.push(captureSquare);
        }
      }
    }

    return moves;
  }

  getKnightMoves(square, color) {
    const moves = [];
    const coord = this.board.squareToCoordinate(square);
    const deltas = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

    for (const [df, dr] of deltas) {
      const newFile = coord.file + df;
      const newRank = coord.rank + dr;

      if (newFile >= 0 && newFile <= 7 && newRank >= 0 && newRank <= 7) {
        const targetSquare = this.board.coordToSquare(newFile, newRank);
        const targetPiece = this.board.getPiece(targetSquare);

        if (!targetPiece || targetPiece.color !== color) {
          moves.push(targetSquare);
        }
      }
    }

    return moves;
  }

  getSlidingMoves(square, color, directions) {
    const moves = [];
    const coord = this.board.squareToCoordinate(square);

    for (const [df, dr] of directions) {
      let newFile = coord.file + df;
      let newRank = coord.rank + dr;

      while (newFile >= 0 && newFile <= 7 && newRank >= 0 && newRank <= 7) {
        const targetSquare = this.board.coordToSquare(newFile, newRank);
        const targetPiece = this.board.getPiece(targetSquare);

        if (!targetPiece) {
          moves.push(targetSquare);
        } else {
          if (targetPiece.color !== color) {
            moves.push(targetSquare);
          }
          break; // Stop at the first piece hit
        }

        newFile += df;
        newRank += dr;
      }
    }

    return moves;
  }

  getBishopMoves(square, color) {
    return this.getSlidingMoves(square, color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  }

  getRookMoves(square, color) {
    return this.getSlidingMoves(square, color, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
  }

  getQueenMoves(square, color) {
    return this.getSlidingMoves(square, color, [
      [1, 1], [1, -1], [-1, 1], [-1, -1],
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ]);
  }

  getKingMoves(square, color) {
    const moves = [];
    const coord = this.board.squareToCoordinate(square);

    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;

        const newFile = coord.file + df;
        const newRank = coord.rank + dr;

        if (newFile >= 0 && newFile <= 7 && newRank >= 0 && newRank <= 7) {
          const targetSquare = this.board.coordToSquare(newFile, newRank);
          const targetPiece = this.board.getPiece(targetSquare);

          if (!targetPiece || targetPiece.color !== color) {
            moves.push(targetSquare);
          }
        }
      }
    }

    // Castling
    const isKingAttacked = this.isSquareAttacked(this.board, square, color);

    if (!isKingAttacked) {
      const startRank = color === 'white' ? 0 : 7;

      // Kingside castling
      if ((color === 'white' && this.board.castling.K) ||
        (color === 'black' && this.board.castling.k)) {
        const f = this.board.coordToSquare(5, startRank);
        const g = this.board.coordToSquare(6, startRank);

        if (!this.board.getPiece(f) && !this.board.getPiece(g) &&
          !this.isSquareAttacked(this.board, f, color) &&
          !this.isSquareAttacked(this.board, g, color)) {
          moves.push(g);
        }
      }

      // Queenside castling
      if ((color === 'white' && this.board.castling.Q) ||
        (color === 'black' && this.board.castling.q)) {
        const d = this.board.coordToSquare(3, startRank);
        const c = this.board.coordToSquare(2, startRank);
        const b = this.board.coordToSquare(1, startRank);

        if (!this.board.getPiece(d) && !this.board.getPiece(c) && !this.board.getPiece(b) &&
          !this.isSquareAttacked(this.board, d, color) &&
          !this.isSquareAttacked(this.board, c, color)) {
          moves.push(c);
        }
      }
    }

    return moves;
  }

  // 3. REVERSE LOOKUP FOR ATTACKS (Huge performance boost)
  isSquareAttacked(board, square, defenderColor) {
    if (!square) return false;
    const attackerColor = defenderColor === 'white' ? 'black' : 'white';
    const coord = board.squareToCoordinate(square);

    // Check Knights (L-shapes)
    const knightDeltas = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    for (const [df, dr] of knightDeltas) {
      const f = coord.file + df, r = coord.rank + dr;
      if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
        const p = board.getPiece(board.coordToSquare(f, r));
        if (p && p.color === attackerColor && p.type === 'knight') return true;
      }
    }

    // Check Pawns
    // White is attacked from above (rank + 1), Black is attacked from below (rank - 1)
    const pawnDir = defenderColor === 'white' ? 1 : -1;
    for (const df of [-1, 1]) {
      const f = coord.file + df, r = coord.rank + pawnDir;
      if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
        const p = board.getPiece(board.coordToSquare(f, r));
        if (p && p.color === attackerColor && p.type === 'pawn') return true;
      }
    }

    // Check Kings (1 square in all directions)
    const kingDeltas = [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]];
    for (const [df, dr] of kingDeltas) {
      const f = coord.file + df, r = coord.rank + dr;
      if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
        const p = board.getPiece(board.coordToSquare(f, r));
        if (p && p.color === attackerColor && p.type === 'king') return true;
      }
    }

    // Helper to raycast for sliding pieces
    const checkSliding = (deltas, types) => {
      for (const [df, dr] of deltas) {
        let f = coord.file + df, r = coord.rank + dr;
        while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
          const p = board.getPiece(board.coordToSquare(f, r));
          if (p) {
            if (p.color === attackerColor && types.includes(p.type)) return true;
            break; // Vision blocked by any piece
          }
          f += df; r += dr;
        }
      }
      return false;
    };

    // Check Rooks & Queens (Straight lines)
    if (checkSliding([[1, 0], [-1, 0], [0, 1], [0, -1]], ['rook', 'queen'])) return true;

    // Check Bishops & Queens (Diagonals)
    if (checkSliding([[1, 1], [1, -1], [-1, 1], [-1, -1]], ['bishop', 'queen'])) return true;

    return false;
  }

  findKing(board, color) {
    for (const [square, piece] of Object.entries(board.board)) {
      if (piece.type === 'king' && piece.color === color) {
        return square;
      }
    }
    return null;
  }

  // 4. Returns a history object so we can instantly undo the move
  makeMove(board, from, to, promotion) {
    const piece = board.getPiece(from);
    if (!piece) return null;

    // Snapshot board state
    const history = {
      from,
      to,
      piece: { ...piece },
      captured: board.getPiece(to),
      castling: { ...board.castling },
      enPassant: board.enPassant,
      turn: board.turn,
      halfMoves: board.halfMoves,
      fullMoves: board.fullMoves,
      rookMove: null, // Track castling rook
      epCapture: null // Track captured en passant pawn
    };

    const fromCoord = board.squareToCoordinate(from);
    const toCoord = board.squareToCoordinate(to);

    // FIXED: En Passant capture removal
    if (piece.type === 'pawn' && to === board.enPassant) {
      const captureRank = piece.color === 'white' ? toCoord.rank - 1 : toCoord.rank + 1;
      const capturedSquare = board.coordToSquare(toCoord.file, captureRank);

      history.epCapture = { square: capturedSquare, piece: board.getPiece(capturedSquare) };
      delete board.board[capturedSquare];
    }

    // Handle castling (move the rook)
    if (piece.type === 'king' && Math.abs(toCoord.file - fromCoord.file) === 2) {
      const rank = fromCoord.rank;
      let rookFrom, rookTo;

      if (toCoord.file - fromCoord.file === 2) { // Kingside
        rookFrom = board.coordToSquare(7, rank);
        rookTo = board.coordToSquare(5, rank);
      } else { // Queenside
        rookFrom = board.coordToSquare(0, rank);
        rookTo = board.coordToSquare(3, rank);
      }

      const rook = board.getPiece(rookFrom);
      if (rook) {
        board.board[rookTo] = rook;
        delete board.board[rookFrom];
        history.rookMove = { from: rookFrom, to: rookTo, piece: rook };
      }
    }

    // Update castling rights if King moves
    if (piece.type === 'king') {
      if (piece.color === 'white') {
        board.castling.K = false; board.castling.Q = false;
      } else {
        board.castling.k = false; board.castling.q = false;
      }
    }

    // Update castling rights if Rook moves
    if (piece.type === 'rook') {
      if (from === 'a1') board.castling.Q = false;
      if (from === 'h1') board.castling.K = false;
      if (from === 'a8') board.castling.q = false;
      if (from === 'h8') board.castling.k = false;
    }

    // Update castling rights if Rook is captured
    if (history.captured && history.captured.type === 'rook') {
      if (to === 'a1') board.castling.Q = false;
      if (to === 'h1') board.castling.K = false;
      if (to === 'a8') board.castling.q = false;
      if (to === 'h8') board.castling.k = false;
    }

    // Set new En Passant target square
    board.enPassant = null;
    if (piece.type === 'pawn' && Math.abs(toCoord.rank - fromCoord.rank) === 2) {
      const epRank = piece.color === 'white' ? fromCoord.rank + 1 : fromCoord.rank - 1;
      board.enPassant = board.coordToSquare(fromCoord.file, epRank);
    }

    // Move the primary piece
    const movedPiece = { ...piece };
    if (promotion && movedPiece.type === 'pawn') {
      movedPiece.type = promotion;
    }
    board.board[to] = movedPiece;
    delete board.board[from];

    // Swap turns
    board.turn = board.turn === 'white' ? 'black' : 'white';

    return history;
  }

  // 5. Instantly restores the board using the history snapshot
  undoMove(board, history) {
    if (!history) return;

    // Restore root state
    board.turn = history.turn;
    board.castling = history.castling;
    board.enPassant = history.enPassant;
    board.halfMoves = history.halfMoves;
    board.fullMoves = history.fullMoves;

    // Move primary piece back to origin (automatically un-promotes if applicable)
    board.board[history.from] = history.piece;
    delete board.board[history.to];

    // Restore captured piece if there was one
    if (history.captured) {
      board.board[history.to] = history.captured;
    }

    // Restore the captured pawn from an en passant
    if (history.epCapture) {
      board.board[history.epCapture.square] = history.epCapture.piece;
    }

    // Put the rook back if it was a castling move
    if (history.rookMove) {
      board.board[history.rookMove.from] = history.rookMove.piece;
      delete board.board[history.rookMove.to];
    }
  }

  getGameStatus() {
    const inCheck = this.isInCheck(this.board.turn);
    const hasLegalMoves = this.hasLegalMoves(this.board.turn);

    if (inCheck && !hasLegalMoves) {
      return {
        status: 'checkmate',
        check: this.board.turn,
        winner: this.board.turn === 'white' ? 'black' : 'white'
      };
    }

    if (!inCheck && !hasLegalMoves) {
      return {
        status: 'stalemate',
        check: null,
        winner: null
      };
    }

    return {
      status: 'ongoing',
      check: inCheck ? this.board.turn : null,
      winner: null
    };
  }

  isInCheck(color) {
    const kingSquare = this.findKing(this.board, color);
    return this.isSquareAttacked(this.board, kingSquare, color);
  }

  hasLegalMoves(color) {
    for (const [square, piece] of Object.entries(this.board.board)) {
      if (piece.color === color) {
        const moves = this.getPieceMoves(square);
        for (const move of moves) {
          if (this.isValidMove(square, move)) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

export default MoveValidator;