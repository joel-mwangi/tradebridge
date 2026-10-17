"use client";

import { Suspense, type ReactNode } from "react";
import TradingWorkspace from "../../components/trading/TradingWorkspace";
import WorkspaceLoading from "../../components/trading/WorkspaceLoading";

/**
 * Keep the trading controller mounted across workspace routes. While it
 * suspends for route/search state, render the same branded skeleton used by
 * the app-level loading boundary instead of flashing a blank screen.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<WorkspaceLoading />}>
        <TradingWorkspace />
      </Suspense>
      {children}
    </>
  );
}
