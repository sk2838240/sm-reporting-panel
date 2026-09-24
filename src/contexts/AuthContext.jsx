import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../lib/supabase';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const profileLoaded = useRef(false);

  const loadProfile = useCallback(async () => {
    setProfileError(null);
    try {
      const data = await api('/api/me');
      setProfile(data.profile);
      setUser(data.user);
      profileLoaded.current = true;
      return data.profile;
    } catch {
      // Retry once after a short delay — handles Vercel cold starts
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const data = await api('/api/me');
        setProfile(data.profile);
        setUser(data.user);
        profileLoaded.current = true;
        return data.profile;
      } catch (e2) {
        setProfile(null);
        setUser(null);
        setProfileError(e2.message || 'Failed to load profile');
        return null;
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      if (session) {
        loadProfile().finally(() => mounted && setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // TOKEN_REFRESHED fires when the user switches browser tabs and comes
      // back (Supabase refreshes the JWT). We must NOT set loading=true here —
      // that would unmount the dashboard via ProtectedRoute and cause a full
      // data re-fetch on every tab switch.
      if (event === 'TOKEN_REFRESHED' && profileLoaded.current) {
        setSession(session);
        return; // keep profile, keep loading=false, don't remount anything
      }

      setSession(session);
      if (session) {
        // Genuine sign-in (or first load) — load the profile
        setLoading(true);
        loadProfile().finally(() => mounted && setLoading(false));
      } else {
        // Sign-out — clear everything
        setProfile(null);
        setUser(null);
        setProfileError(null);
        profileLoaded.current = false;
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setSession(null);
    setProfileError(null);
    profileLoaded.current = false;
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, profileError, refreshProfile: loadProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
