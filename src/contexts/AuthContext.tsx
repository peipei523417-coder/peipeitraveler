import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});


export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronous optimistic init from localStorage to avoid loading flash
  const getInitialSession = (): { user: User | null; session: Session | null } => {
    try {
      const stored = localStorage.getItem(`sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.access_token && parsed?.user) {
          return { user: parsed.user as User, session: parsed as unknown as Session };
        }
      }
    } catch { /* ignore */ }
    return { user: null, session: null };
  };

  const initial = getInitialSession();
  const [user, setUser] = useState<User | null>(initial.user);
  const [session, setSession] = useState<Session | null>(initial.session);
  const [loading, setLoading] = useState(true);
  const sessionRestoreDoneRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    // Set up auth state listener BEFORE getting session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!isMounted) return;
        console.log("[AuthContext] auth state change", {
          event,
          sessionRestoreDone: sessionRestoreDoneRef.current,
          hasSession: !!currentSession,
          userId: currentSession?.user?.id ?? null,
        });
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
      }
    );

    // Get initial session (validates the cached one)
    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => {
        if (!isMounted) return;
        sessionRestoreDoneRef.current = true;
        console.log("[AuthContext] getSession resolved", {
          hasSession: !!initialSession,
          userId: initialSession?.user?.id ?? null,
        });
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        sessionRestoreDoneRef.current = true;
        console.warn("[AuthContext] getSession failed — auth loading finished without redirect decision");
        setLoading(false);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
