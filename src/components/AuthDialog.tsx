/**
 * Dialog für Anmelden / Konto erstellen (Supabase Auth).
 * Ort: src/components/AuthDialog.tsx
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { AuthLoginForm } from "./AuthLoginForm";
import { AuthSignupForm } from "./AuthSignupForm";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Tab = "login" | "signup";

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const [tab, setTab] = useState<Tab>("login");

  function handleSuccess() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-visudev-modal="auth">
        <DialogHeader>
          <DialogTitle>{tab === "login" ? "Anmelden" : "Konto erstellen"}</DialogTitle>
        </DialogHeader>
        {tab === "login" ? (
          <AuthLoginForm onSuccess={handleSuccess} onSwitchToSignup={() => setTab("signup")} />
        ) : (
          <AuthSignupForm onSuccess={handleSuccess} onSwitchToLogin={() => setTab("login")} />
        )}
      </DialogContent>
    </Dialog>
  );
}
