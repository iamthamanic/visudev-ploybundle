/**
 * Login-Formular (E-Mail/Passwort) für Supabase Auth.
 * Ort: src/components/AuthLoginForm.tsx
 */

import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useAuth } from "../contexts/useAuth";
import { getDevDemoAuthCredentials } from "../utils/devDemoAuth";
import styles from "./AuthForms.module.css";

interface AuthLoginFormProps {
  onSuccess?: () => void;
  onSwitchToSignup?: () => void;
}

export function AuthLoginForm({ onSuccess, onSwitchToSignup }: AuthLoginFormProps) {
  const { signInWithPassword } = useAuth();
  const demoCreds = useMemo(() => getDevDemoAuthCredentials(), []);
  const [email, setEmail] = useState(demoCreds?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithPassword(email, password);
    setLoading(false);
    if (err) {
      const isInvalidCreds =
        /invalid (login )?credentials?/i.test(err.message) ||
        /invalid_credentials/i.test(err.message);
      const hint =
        isInvalidCreds &&
        typeof window !== "undefined" &&
        (window.location.origin.includes("127.0.0.1") ||
          window.location.origin.includes("localhost"))
          ? " Bei lokalem Supabase: Erst „Konto erstellen“ verwenden (Cloud-Nutzer existieren lokal nicht)."
          : "";
      setError(err.message + hint);
      return;
    }
    onSuccess?.();
  }

  async function handleDemoLogin() {
    if (!demoCreds) return;
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithPassword(demoCreds.email, demoCreds.password);
    setLoading(false);
    if (err) {
      setError(
        err.message +
          " (Demo-Account muss in Supabase existieren — einmal „Konto erstellen“ oder im Dashboard anlegen.)",
      );
      return;
    }
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <Label htmlFor="auth-login-email">E-Mail</Label>
        <Input
          id="auth-login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          disabled={loading}
        />
      </div>
      <div className={styles.field}>
        <Label htmlFor="auth-login-password">Passwort</Label>
        <Input
          id="auth-login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          disabled={loading}
        />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <Button type="submit" disabled={loading}>
          {loading ? "Wird angemeldet…" : "Anmelden"}
        </Button>
        {demoCreds && (
          <Button type="button" variant="outline" disabled={loading} onClick={handleDemoLogin}>
            Als Demo anmelden
          </Button>
        )}
        {onSwitchToSignup && (
          <Button type="button" variant="ghost" onClick={onSwitchToSignup}>
            Konto erstellen
          </Button>
        )}
      </div>
    </form>
  );
}
