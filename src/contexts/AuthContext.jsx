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
  const [retrying, setRetrying] = useState(false);
  const profileLoaded = useRef(false);
  // getSession() and onAuthStateChange's INITIAL_SESSION both fire on first
  // load, in parallel. Without this guard every cold page load issued two
  // GET /api/me, and a slow endpoint doubled again through the retry path.
  // Keyed to the user id so it can never be served across a sign-out: a
  // surviving promise from the previous session would set the previous user's
  // profile for whoever signs in next.
  const inFlight = useRef(null);

  // force=true bypasses the de-duplication. The "Try again" button must always
  // hit the network: reusing a settled promise (either the cached failure or a
  // cached success) makes the button a no-op that looks broken.
  const loadProfile = useCallback(async ({ force = false } = {}) => {
    if (!force && inFlight.current && inFlight.current.userId === (session?.id ?? null)) {
      return inFlight.current.promise;
    }
    const userId = session?.id ?? null;
    const run = async () => {
      try {
        const data = await api('/api/me');
        setProfile(data.profile);
        setUser(data.user);
        profileLoaded.current = true;
        setProfileError(null);
        return data.profile;
      } catch {
        // Retry once after a short delay — handles Vercel cold starts
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const data = await api('/api/me');
          setProfile(data.profile);
          setUser(data.user);
          profileLoaded.current = true;
          setProfileError(null);
          return data.profile;
        } catch (e2) {
          setProfile(null);
          setUser(null);
          setProfileError(e2.message || 'Failed to load profile');
          return null;
        }
      } finally {
        // Wraps BOTH paths, and is compared against the id captured at call
        // time so a newer request for the same user is never cancelled out.
        if (inFlight.current?.userId === userId) inFlight.current = null;
      }
    };
    const promise = run();
    inFlight.current = { userId, promise };
    return promise;
  }, [session?.id]);

  // Explicit retry from the "Couldn't load your account" screen. It must own
  // the loading flag: loadProfile only clears profileError, so ProtectedRoute
  // would render with profile === null, profileError === null and
  // loading === false, fall through its guard, and redirect to /login — the
  // recovery button bounced the user out instead of retrying.
  const refreshProfile = useCallback(async () => {
    setRetrying(true);
    // force: the user explicitly asked for a new attempt, so a still-recorded
    // in-flight or already-settled promise must not be replayed.
    try {
      await loadProfile({ force: true });
    } finally {
      setRetrying(false);
    }
  }, [loadProfile]);

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
      // INITIAL_SESSION duplicates the getSession() above; loadProfile() now
      // de-duplicates in flight, so returning early here is safe and avoids a
      // pointless loading=true -> render -> remount cycle.
      if (event === 'INITIAL_SESSION' && profileLoaded.current) {
        setSession(session);
        return;
      }

      setSession(session);
      if (session) {
        // Genuine sign-in (or first load) — load the profile
        setLoading(true);
        loadProfile().finally(() => mounted && setLoading(false));
      } else {
        // Sign-out — clear everything. inFlight MUST be cleared too: a pending
        // request from the outgoing session would otherwise resolve after this
        // and re-populate the signed-out user's profile, which the next person
        // to sign in on this browser would inherit.
        setProfile(null);
        setUser(null);
        setSession(null);
        setProfileError(null);
        profileLoaded.current = false;
        inFlight.current = null;
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
    inFlight.current = null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, profileError, retrying, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
