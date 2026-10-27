"use client";

import styles from "./TradingWorkspace.module.css";
import { Skeleton } from "./Skeleton";
import type { AccountActivity, OpenPosition } from "./types";

type Props = {
  positionsOnly?: boolean;
  positions: OpenPosition[];
  activity: AccountActivity[];
  currency: string;
  accountType: "demo" | "real" | "other";
  accountDataUnavailable?: boolean;
  busy: boolean;
  activityLoading: boolean;
  activityHasMore: boolean;
  onSell: (contractId: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
};

function money(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) + " " + currency;
  }
}
function dateLabel(epoch: number | null) {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function actionLabel(action: string) {
  const value = action.toLowerCase();
  if (value === "buy") return "Purchased";
  if (value === "sell") return "Sold";
  if (value === "deposit") return "Deposit";
  if (value === "withdrawal") return "Withdrawal";
  return action.replace(/_/g, " ");
}
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

export default function TradingActivity({
  positionsOnly = false, positions, activity, currency, accountType, accountDataUnavailable = false, busy, activityLoading, activityHasMore,
  onSell, onRefresh, onLoadMore,
}: Props) {
  const liveAccount = accountType === "real";
  const canClosePositions = accountType === "demo" || accountType === "real";

  function exportStatement() {
    const headers = ["Transaction ID", "Time", "Action", "Description", "Amount", "Balance", "Currency", "Contract ID"];
    const rows = activity.map((item) => [
      item.id, item.time ? new Date(item.time * 1000).toISOString() : "", item.action,
      item.description, item.amount, item.balance, item.currency, item.contractId ?? "",
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tradebridge-statement-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <div className={positionsOnly ? styles.activityGridSingle : styles.activityGrid} id="activity">
    <section className={styles.activityPanel}>
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>{liveAccount ? "LIVE ACCOUNT" : "DEMO ACCOUNT"}</p><h2>Open positions <span className={styles.countPill}>{positions.length}</span></h2><p className={styles.panelSubtext}>Open Deriv contracts · current profit/loss updates when available.</p></div>
        <button type="button" className={styles.panelActionButton} onClick={onRefresh} disabled={busy || activityLoading}>Refresh</button>
      </div>
      {positions.length === 0 && busy && !accountDataUnavailable ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }} aria-label="Loading positions">
          {[1, 2].map((i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
              <Skeleton size="xl" width="w25" style={{ flexShrink: 0, borderRadius: 10, height: 44 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton size="sm" width="w70" />
                <Skeleton size="xs" width="w55" />
              </div>
              <Skeleton size="btn" style={{ flexShrink: 0, width: 80 }} />
            </div>
          ))}
        </div>
      ) : positions.length === 0 ? <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>◷</span><strong>{accountDataUnavailable ? "Live positions unavailable" : "No open positions"}</strong><p>{accountDataUnavailable ? "TradeBridge is connecting to your real account session. Live positions will appear once connected." : "After Deriv confirms an order, active contracts appear here with their current status and profit/loss."}</p>
      </div> : <div className={styles.positionList}>
        {positions.map((position) => <article className={styles.positionRow} key={position.contractId}>
          <div className={styles.positionLead}><span className={styles.positionSymbol}>{position.contractType.toLowerCase().includes("put") || position.contractType.toLowerCase().includes("lower") ? "↘" : "↗"}</span><div><strong>{position.symbol} · {position.contractType}</strong><small>Contract #{position.contractId} · {position.status}</small>{position.longcode && <small className={styles.positionDescription}>{position.longcode}</small>}{position.currentSpot !== null && <small>Current spot: {position.currentSpot}</small>}</div></div>
          <div className={styles.positionManage}>
            <div className={styles.positionNumbers}><span><small>Stake</small><strong>{money(position.buyPrice, position.currency)}</strong></span><span><small>Potential payout</small><strong>{money(position.payout, position.currency)}</strong></span><span><small>Current P/L</small><strong className={position.profit === null ? "" : position.profit >= 0 ? styles.positive : styles.negative}>{money(position.profit, position.currency)}</strong></span></div>
            {canClosePositions && <button type="button" className={styles.sellPositionButton} onClick={() => onSell(position.contractId)} disabled={busy} aria-label={"Sell contract " + position.contractId + " at market"}>Sell at market</button>}
          </div>
        </article>)}
      </div>}
    </section>

    {!positionsOnly && (
    <section className={styles.activityPanel}>
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>ACCOUNT STATEMENT</p><h2>Recent activity</h2><p className={styles.panelSubtext}>Latest transactions returned by Deriv.</p></div>
        <div className={styles.panelActions}>
          <button type="button" className={styles.panelActionButton} onClick={onRefresh} disabled={busy || activityLoading}>Refresh</button>
          <button type="button" className={styles.panelActionButton} onClick={exportStatement} disabled={activity.length === 0}>Export CSV</button>
        </div>
      </div>
      {activity.length === 0 && activityLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }} aria-label="Loading activity">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
              <Skeleton circle style={{ flexShrink: 0, width: 28, height: 28 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                <Skeleton size="sm" width="w55" />
                <Skeleton size="xs" width="w85" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                <Skeleton size="sm" style={{ width: 70 }} />
                <Skeleton size="xs" style={{ width: 55 }} />
              </div>
            </div>
          ))}
        </div>
      ) : activity.length === 0 ? <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>↺</span><strong>{accountDataUnavailable ? "Live statement unavailable" : "No transactions returned yet"}</strong><p>{accountDataUnavailable ? "TradeBridge is connecting to your real account session. Live statement activity will appear once connected." : "Purchases, sales, and other account events appear after Deriv returns a statement. No sample trades are shown."}</p>
      </div> : <div className={styles.activityList}>
        {activity.map((item) => <article key={item.id} className={styles.activityRow}>
          <span className={styles.activityIcon}>{item.action.toLowerCase() === "buy" ? "↗" : item.action.toLowerCase() === "sell" ? "↘" : "•"}</span>
          <div className={styles.activityDetails}><strong>{actionLabel(item.action)}</strong><small>{item.description}</small><small>{dateLabel(item.time)}{item.contractId ? " · Contract #" + item.contractId : ""}</small></div>
          <div className={styles.activityAmount}><strong className={item.amount === null ? "" : item.amount < 0 ? styles.negative : styles.positive}>{money(item.amount, item.currency || currency)}</strong>{item.balance !== null && <small>Balance {money(item.balance, item.currency || currency)}</small>}</div>
        </article>)}
      </div>}
      {activityHasMore && <div className={styles.statementPagination}>
        <button type="button" className={styles.panelActionButton} onClick={onLoadMore} disabled={activityLoading}>
          {activityLoading ? "Loading transactions…" : "Load older transactions"}
        </button>
      </div>}
      {activityLoading && activity.length === 0 && <span aria-live="polite" className="sr-only">Loading statement from Deriv…</span>}
      <p className={styles.statementFootnote}>Export includes the transactions currently loaded from Deriv, not the account&apos;s full lifetime archive.</p>
    </section>
    )}
  </div>;
}
