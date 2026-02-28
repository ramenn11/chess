import React from "react";
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/layout/NavBar';
import Sidebar from './components/layout/Sidebar';
import Footer from './components/layout/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import BotGame from './pages/BotGame';
import Register from "./pages/Register";
import Login from "./pages/Login";
import NotFound from './pages/NotFound';
import Home from './pages/Home';
import Game from './pages/Game';
import Profile from './pages/Profile';
import Matchmaking from './pages/Matchmaking';
import Lobby from './pages/Lobby';
import Friends from './pages/Friends';
import Spectate from './pages/Spectate';

import { AuthProvider } from "./context/AuthContext";
import useUserNotifications from './hooks/useUserNotifications';

function AppRouter() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/*"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

function MainLayout() {
  useUserNotifications();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/game/:gameId" element={<Game />} />
            <Route path="/matchmaking" element={<Matchmaking />} />
            <Route path="/lobby" element={<Lobby />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/spectate" element={<Spectate />} />
            <Route path="/profile/:username" element={<Profile />} />
            <Route path="/404" element={<NotFound />} />
            <Route path="/bot" element={<BotGame />} />
            <Route path="/bot/:gameId" element={<BotGame />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </main>
      </div>
      <Footer />
    </div>
  );
}

export default AppRouter;