import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { updateSocketAuth } from '../socket.js';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Validate existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('chess_token');
    if (!token) {
      setLoading(false);
      return;
    }
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ user }) => {
        setUser(user);
        updateSocketAuth(token);
      })
      .catch(() => {
        localStorage.removeItem('chess_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('chess_token', data.token);
    setUser(data.user);
    updateSocketAuth(data.token);
    return data.user;
  }, []);

  const register = useCallback(async (username, email, password) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    localStorage.setItem('chess_token', data.token);
    setUser(data.user);
    updateSocketAuth(data.token);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('chess_token');
    setUser(null);
    updateSocketAuth(null);
  }, []);

  const updateProfile = useCallback(async (username, avatar_id) => {
    const token = localStorage.getItem('chess_token');
    const body = { username };
    if (avatar_id) body.avatar_id = avatar_id;
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
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
