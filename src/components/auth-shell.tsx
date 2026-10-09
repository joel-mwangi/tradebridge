import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <Link className="auth-brand" href="/login" aria-label="TradeBridge home">
        <span className="brand-icon">T</span><span>Trade<span className="accent">Bridge</span></span>
      </Link>
      <p className="auth-eyebrow">YOUR TRADING WORKSPACE</p>
      <h1 id="auth-title">{title}</h1>
      <p className="auth-subtitle">{subtitle}</p>
      {children}
      <p className="auth-legal">By continuing, you agree to use TradeBridge responsibly. Demo trading only in this build.</p>
    </section>
  </main>;
}
