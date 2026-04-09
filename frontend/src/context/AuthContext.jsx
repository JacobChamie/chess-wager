import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { updateSocketAuth } from '../socket.js';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = useCallback(async (tokenOverride) => {
    const token = tokenOverride || localStorage.getItem('chess_token');
    if (!token) {
      setUser(null);
      updateSocketAuth(null);
      return null;
    }

    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch user');
    }

    const { user: nextUser } = await res.json();
    setUser(nextUser);
    updateSocketAuth(token);
    return nextUser;
  }, []);

  // Validate existing token on mount
  useEffect(() => {
    fetchCurrentUser()
      .catch(() => {
        localStorage.removeItem('chess_token');
        setUser(null);
        updateSocketAuth(null);
      })
      .finally(() => setLoading(false));
  }, [fetchCurrentUser]);

  const refreshUser = useCallback(async () => {
    try {
      return await fetchCurrentUser();
    } catch {
      localStorage.removeItem('chess_token');
      setUser(null);
      updateSocketAuth(null);
      return null;
    }
  }, [fetchCurrentUser]);

  const mergeUser = useCallback((updates) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      if (localStorage.getItem('chess_token')) {
        refreshUser();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && localStorage.getItem('chess_token')) {
        refreshUser();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshUser]);

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('chess_token', data.token);
    updateSocketAuth(data.token);
    return fetchCurrentUser(data.token).catch(() => {
      setUser(data.user);
      return data.user;
    });
  }, [fetchCurrentUser]);

  const register = useCallback(async (username, email, password) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    localStorage.setItem('chess_token', data.token);
    updateSocketAuth(data.token);
    return fetchCurrentUser(data.token).catch(() => {
      setUser(data.user);
      return data.user;
    });
  }, [fetchCurrentUser]);

  const logout = useCallback(() => {
    localStorage.removeItem('chess_token');
    setUser(null);
    updateSocketAuth(null);
  }, []);

  const updateProfile = useCallback(async (username, avatar_id, board_theme, animation_speed, profanity_filter) => {
    const token = localStorage.getItem('chess_token');
    const body = { username };
    if (avatar_id) body.avatar_id = avatar_id;
    if (board_theme) body.board_theme = board_theme;
    if (animation_speed) body.animation_speed = animation_speed;
    if (typeof profanity_filter === 'boolean') body.profanity_filter = profanity_filter;
    const res = await fetch(`${API_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed');
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile, refreshUser, mergeUser }}>
      {children}
    </AuthContext.Provider>
  );
};
