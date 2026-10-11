"use client";

import type { ReactNode } from "react";
import TradingWorkspace from "../../components/trading/TradingWorkspace";

/**
 * Keep the trading controller mounted across all workspace routes.
 * The shell reads usePathname() to switch page content while its account,
 * market-data and trading-session hooks remain alive during route changes.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TradingWorkspace />
      {children}
    </>
  );
}
