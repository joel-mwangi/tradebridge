"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import AuthShell from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      setMessage(error ? error.message : "If an account exists for that email, a password-reset link has been sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to request a reset right now.");
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell title="Reset your password" subtitle="We’ll email you a secure link to choose a new password.">
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      <div className="auth-links"><Link href="/login">Back to sign in</Link></div>
    </form>
  </AuthShell>;
}
