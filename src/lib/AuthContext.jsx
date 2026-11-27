import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

function hasStoredToken() {
  try { return !!localStorage.getItem('auth_token'); } catch { return false; }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  // The caller's TeamMember row (role/rates/etc), if one exists — most
  // StudioTime staff have one, but a freshly-approved account may not yet.
  const [teamMember, setTeamMember] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const checkUserAuth = useCallback(async () => {
    if (!hasStoredToken()) {
      setIsAuthenticated(false);
      setUser(null);
      setTeamMember(null);
      setAuthError(null);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return;
    }
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      try {
        const rows = await base44.entities.TeamMember.filter({ user_id: currentUser.id });
        setTeamMember(rows?.[0] || null);
      } catch {
        setTeamMember(null);
      }
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      setTeamMember(null);
      if (error.status === 401 || error.status === 403) {
        setAuthError({ type: 'auth_required', message: error.message });
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setTeamMember(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      base44.auth.logout(window.location.href);
    } else {
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{
      user,
      teamMember,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
