/**
 * Demo-Login nur für lokale Entwicklung (Vite `import.meta.env.DEV`).
 * Zugangsdaten ausschließlich via `.env.local` (VITE_DEMO_AUTH_*), nicht committen.
 */

export function getDevDemoAuthCredentials(): { email: string; password: string } | null {
  if (!import.meta.env.DEV) return null;
  const email = import.meta.env.VITE_DEMO_AUTH_EMAIL;
  const password = import.meta.env.VITE_DEMO_AUTH_PASSWORD;
  if (typeof email !== "string" || email.trim() === "") return null;
  if (typeof password !== "string" || password === "") return null;
  return { email: email.trim(), password };
}
