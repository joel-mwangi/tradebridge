"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import TradingWorkspace from "../../components/trading/TradingWorkspace";
import FastApiLiveMarketFeed from "../../components/trading/FastApiLiveMarketFeed";

/**
 * Keep the trading controller mounted across workspace routes.
 * The shell keeps account, market-data and trading-session hooks alive
 * while route content changes.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <Suspense>
        <TradingWorkspace />
      </Suspense>
      {pathname === "/markets" && <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 24px" }}><FastApiLiveMarketFeed /></div>}
      {children}
    </>
  );
}
