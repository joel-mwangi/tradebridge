"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import AuthShell from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) setMessage(error.message);
      else if (!data.session) {
        setSuccess(true);
        setMessage("Account created. Check your email to verify your address, then sign in.");
      } else window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create your account right now.");
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell title="Create your account" subtitle="Your TradeBridge login is separate from connecting your Deriv account.">
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="name">Full name</label>
      <input id="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
      <p className="auth-hint">Use at least 8 characters.</p>
      {message && <p className={success ? "auth-success" : "auth-message"} role="status">{message}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      <div className="auth-links"><span>Already registered? <Link href="/login">Sign in</Link></span></div>
    </form>
  </AuthShell>;
}
