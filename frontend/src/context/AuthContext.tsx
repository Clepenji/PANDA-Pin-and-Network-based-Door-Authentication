import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, UserRole } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  login: (email: string) => Promise<void>;
  loginWithGoogle: (param: string | { credential?: string; code?: string; redirect_uri?: string }) => Promise<any>;
  registerUser: (payload: {
    email: string;
    name: string;
    phone: string;
    college_year?: string;
    club_name?: string;
    space_id: string;
    assigned_superuser_id?: string;
    oauth_registration_token?: string;
  }) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('panda_token'));
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const initializeAuth = async () => {
      const savedToken = localStorage.getItem('panda_token');
      const savedProfile = localStorage.getItem('panda_profile');
      if (savedToken && savedProfile) {
        try {
          setUser(JSON.parse(savedProfile));
          setToken(savedToken);
        } catch {
          localStorage.removeItem('panda_token');
          localStorage.removeItem('panda_profile');
        }
      }
      setLoading(false);
    };
    initializeAuth();
  }, []);

  const login = async (email: string) => {
    setLoading(true);
    try {
      const resp = await api.loginWithEmail(email);
      const profile: UserProfile = {
        id: resp.email,
        email: resp.email,
        name: resp.name,
        role: resp.role as UserRole,
        is_root: resp.is_root,
        authorized_spaces: resp.authorized_spaces,
      };

      localStorage.setItem('panda_token', resp.access_token);
      localStorage.setItem('panda_profile', JSON.stringify(profile));
      setToken(resp.access_token);
      setUser(profile);
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async (param: string | { credential?: string; code?: string; redirect_uri?: string }): Promise<any> => {
    setLoading(true);
    try {
      const payload = typeof param === 'string' ? { credential: param } : param;
      const resp = await api.loginWithGoogleOAuth(payload);
      if (resp.status === 'LOGGED_IN' && resp.access_token) {
        const profile: UserProfile = {
          id: resp.email,
          email: resp.email,
          name: resp.name,
          role: resp.role as UserRole,
          is_root: resp.is_root,
          authorized_spaces: resp.authorized_spaces || [],
          college_year: resp.college_year,
        };
        localStorage.setItem('panda_token', resp.access_token);
        localStorage.setItem('panda_profile', JSON.stringify(profile));
        setToken(resp.access_token);
        setUser(profile);
      }
      return resp;
    } finally {
      setLoading(false);
    }
  };

  const registerUser = async (payload: {
    email: string;
    name: string;
    phone: string;
    college_year?: string;
    club_name?: string;
    space_id: string;
    assigned_superuser_id?: string;
    oauth_registration_token?: string;
  }) => {
    setLoading(true);
    try {
      const resp = await api.register(payload);
      const profile: UserProfile = {
        id: resp.email,
        email: resp.email,
        name: resp.name,
        role: resp.role as UserRole,
        is_root: resp.is_root,
        college_year: payload.college_year,
        authorized_spaces: resp.authorized_spaces,
      };

      localStorage.setItem('panda_token', resp.access_token);
      localStorage.setItem('panda_profile', JSON.stringify(profile));
      setToken(resp.access_token);
      setUser(profile);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    try {
      const p = await api.fetchProfile();
      setUser(p);
      localStorage.setItem('panda_profile', JSON.stringify(p));
    } catch (e) {
      console.warn('Failed to refresh profile:', e);
    }
  };

  const logout = () => {
    localStorage.removeItem('panda_token');
    localStorage.removeItem('panda_profile');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithGoogle, registerUser, refreshProfile, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
