"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth-shell";

export default function LoginPage() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(params.get("error") === "configuration"
    ? "Platform authentication is not configured yet. Add the Supabase environment variables in Vercel."
    : params.get("error") === "callback"
      ? "We could not complete sign-in. Please try again."
      : "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMessage(error.message);
      else window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in right now.");
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell title="Welcome back" subtitle="Sign in to your TradeBridge account to access your trading workspace.">
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      {message && <p className="auth-message" role="alert">{message}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><span>New to TradeBridge? <Link href="/register">Create account</Link></span></div>
    </form>
  </AuthShell>;
}
