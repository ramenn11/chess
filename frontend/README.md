# structuring of React-application

chess-app/
  frontend/                            # Frontend React Application
    public/
      assets/
        pieces/                      # Chess piece images/SVGs
        sounds/                      # Move sounds, captures, etc.
      index.html

    src/
      components/
        common/
          Button.jsx
          Modal.jsx
          Avatar.jsx
          Loader.jsx
          Toast.jsx

        layout/
          Navbar.jsx
          Sidebar.jsx
          Footer.jsx

        chess/
          ChessBoard.jsx             # Main board component
          Square.jsx                 # Individual square
          Piece.jsx                  # Chess piece component
          MoveHistory.jsx            # Move list display
          CapturedPieces.jsx         # Captured pieces display
          GameControls.jsx           # Resign, draw, etc.
          PromotionModal.jsx         # Pawn promotion UI
          GameClock.jsx              # Timer display

        lobby/
          LobbyCard.jsx              # Individual lobby card
          LobbyList.jsx              # List of lobbies
          CreateLobbyModal.jsx       # Create lobby form
          LobbySettings.jsx          # Tournament settings

        tournament/
          TournamentBracket.jsx      # Bracket visualization
          TournamentStandings.jsx    # Current standings
          TournamentInfo.jsx         # Tournament details
          MatchCard.jsx              # Individual match display

        profile/
          UserProfile.jsx            # User profile page
          ProfileStats.jsx           # Statistics display
          MatchHistory.jsx           # Past games
          FriendsList.jsx            # Friends management
          EditProfile.jsx            # Profile editor

        spectate/
          SpectatorView.jsx          # Watch game UI
          GamesList.jsx              # Live games list
          Chat.jsx                   # Spectator chat
          ViewerCount.jsx            # Number of viewers

        social/
          FriendSearch.jsx           # Search for friends
          FriendRequest.jsx          # Friend request UI
          ChatBox.jsx                # Direct messaging
          Notifications.jsx          # Notification center

      pages/
        Home.jsx                     # Landing page
        Game.jsx                     # Active game page
        Lobby.jsx                    # Lobby/Tournament page
        Profile.jsx                  # User profile page
        Spectate.jsx                 # Spectator page
        Friends.jsx                  # Friends management
        Login.jsx                    # Authentication
        Register.jsx                 # User registration
        NotFound.jsx                 # 404 page

      hooks/
        useChessGame.js              # Game state management
        useWebSocket.js              # WebSocket connection
        useAuth.js                   # Authentication
        useTournament.js             # Tournament logic
        useTimer.js                  # Game clock
        useSound.js                  # Sound effects

      context/
        AuthContext.jsx              # User authentication
        SocketContext.jsx            # WebSocket provider
        ThemeContext.jsx             # Theme management

      services/
        api.js                       # API client setup
        authService.js               # Auth API calls
        gameService.js               # Game API calls
        tournamentService.js         # Tournament API
        userService.js               # User API calls
        socketService.js             # WebSocket handlers

      utils/
        constants.js                 # App constants
        helpers.js                   # Utility functions
        validators.js                # Input validation

      styles/
        globals.css                  # Global styles
        chessboard.css               # Board styles
        animations.css               # Animations

      App.jsx                        # Root component
      main.jsx                       # Entry point
      router.jsx                     # Route configuration

    package.json
    vite.config.js
    tailwind.config.js

