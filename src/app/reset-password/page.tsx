"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) { setMessage("The passwords do not match."); return; }
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setMessage(error.message);
      else router.push("/login?password_updated=1");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update your password right now.");
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell title="Choose a new password" subtitle="Set a new password for your TradeBridge account.">
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="password">New password</label>
      <input id="password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required />
      <label htmlFor="confirm">Confirm new password</label>
      <input id="confirm" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} required />
      {message && <p className="auth-message" role="alert">{message}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
    </form>
  </AuthShell>;
}
