/**
 * AuthProvider: Supabase Auth (Session, signIn, signUp, signOut) für die App.
 * Liefert user, session, loading und Auth-Aktionen. Ort: src/contexts/AuthContext.tsx
 * Invalidates session when it was issued by a different Supabase (e.g. cloud vs local).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase/client";
import { supabaseUrl } from "../utils/supabase/info";
import type { Session, User } from "@jsr/supabase__supabase-js";
import { AuthContext } from "./authContextRef";
import type { AuthContextValue } from "./authContextRef";

function getIssuerFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
    return typeof payload.iss === "string" ? payload.iss : null;
  } catch {
    return null;
  }
}

/** Only invalidate when session is clearly from the other environment (e.g. cloud session vs local API). */
function shouldInvalidateSession(supabaseUrl: string, sessionIss: string | null): boolean {
  if (!sessionIss) return false;
  const isLocalUrl = supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost");
  const issIsLocal = sessionIss.includes("127.0.0.1") || sessionIss.includes("localhost");
  const issIsCloud = sessionIss.includes("supabase.co");
  const isCloudUrl = supabaseUrl.includes("supabase.co");
  if (isLocalUrl && issIsCloud) return true;
  if (isCloudUrl && issIsLocal) return true;
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    /** Wenn getSession() nie zurückkommt (Netzwerk, blockierte Domain), UI sonst ewig „Wird geladen…“. */
    const safetyMs = 15_000;
    const safetyTimer = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, safetyMs);

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (cancelled) return;
        if (s?.access_token) {
          const iss = getIssuerFromJwt(s.access_token);
          if (shouldInvalidateSession(supabaseUrl, iss)) {
            void supabase.auth.signOut();
            setSession(null);
            setUser(null);
          } else {
            setSession(s);
            setUser(s?.user ?? null);
          }
        } else {
          setSession(s);
          setUser(s?.user ?? null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setUser(null);
      })
      .finally(() => {
        window.clearTimeout(safetyTimer);
        if (!cancelled) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.access_token) {
        const iss = getIssuerFromJwt(s.access_token);
        if (shouldInvalidateSession(supabaseUrl, iss)) {
          void supabase.auth.signOut();
          setSession(null);
          setUser(null);
          return;
        }
      }
      setSession(s);
      setUser(s?.user ?? null);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      signInWithPassword,
      signUp,
      signOut,
    }),
    [user, session, loading, signInWithPassword, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
