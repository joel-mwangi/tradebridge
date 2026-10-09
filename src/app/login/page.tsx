"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth-shell";
import GoogleSignInButton from "@/components/google-sign-in-button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [nextPath, setNextPath] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("next");
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) setNextPath(requested);

    if (params.get("error") === "configuration") {
      setMessage("Sign-in is temporarily unavailable. Please try again later.");
    } else if (params.get("error") === "callback" || params.get("error") === "google") {
      setMessage("We could not complete sign-in. Please try again.");
    } else if (params.get("signed_out") === "1") {
      setMessage("You have signed out of TradeBridge.");
    } else if (params.get("password_updated") === "1") {
      setMessage("Your password has been updated. Sign in with your new password.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setMessage("We could not sign you in with those details. Check them and try again.");
      } else {
        window.location.assign(nextPath);
      }
    } catch {
      setMessage("Unable to sign in right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell title="Welcome back" subtitle="Sign in to your TradeBridge account to access your trading workspace.">
    <div className="auth-social">
      <GoogleSignInButton next={nextPath} />
      <div className="auth-divider"><span>or sign in with email</span></div>
    </div>
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><span>New to TradeBridge? <Link href="/register">Create account</Link></span></div>
    </form>
  </AuthShell>;
}
