import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  type Credentials,
  type StoredCredentials,
  getStoredCredentials,
  resolveCredentials,
  clearStoredCredentials,
} from './lib/auth';
import { initEncryption } from './lib/encryption';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Session } from './pages/Session';

interface AuthContext {
  credentials: Credentials | null;
  setCredentials: (creds: Credentials | null) => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthContext>({
  credentials: null,
  setCredentials: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

export function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await initEncryption();
      const stored = getStoredCredentials();
      if (stored) {
        try {
          const creds = await resolveCredentials(stored);
          setCredentials(creds);
        } catch {
          clearStoredCredentials();
        }
      }
      setLoading(false);
    })();
  }, []);

  const logout = () => {
    clearStoredCredentials();
    setCredentials(null);
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'var(--font-logo)',
        fontSize: 20,
        color: 'var(--text-secondary)',
      }}>
        Loading...
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ credentials, setCredentials, logout }}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              credentials ? <Navigate to="/" replace /> : <Login />
            }
          />
          <Route
            path="/"
            element={
              credentials ? <Home /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/session/:sessionId"
            element={
              credentials ? <Session /> : <Navigate to="/login" replace />
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  );
}
