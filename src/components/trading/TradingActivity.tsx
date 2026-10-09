"use client";

import styles from "./TradingWorkspace.module.css";
import type { AccountActivity, OpenPosition } from "./types";

type Props = { positions: OpenPosition[]; activity: AccountActivity[]; currency: string };

function money(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
}
function dateLabel(epoch: number | null) {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function actionLabel(action: string) {
  const value = action.toLowerCase();
  if (value === "buy") return "Purchased";
  if (value === "sell") return "Sold";
  if (value === "deposit") return "Deposit";
  if (value === "withdrawal") return "Withdrawal";
  return action.replace(/_/g, " ");
}

export default function TradingActivity({ positions, activity, currency }: Props) {
  return <div className={styles.activityGrid} id="activity">
    <section className={styles.activityPanel}>
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>LIVE ACCOUNT</p><h2>Open positions <span className={styles.countPill}>{positions.length}</span></h2><p className={styles.panelSubtext}>Open contracts from the selected demo account.</p></div>
      </div>
      {positions.length === 0 ? <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>◷</span><strong>No open positions</strong><p>After Deriv confirms a demo order, any active contract will appear here with its current status and profit/loss.</p>
      </div> : <div className={styles.positionList}>
        {positions.map((position) => <article className={styles.positionRow} key={position.contractId}>
          <div className={styles.positionLead}><span className={styles.positionSymbol}>{position.contractType.toLowerCase().includes("put") || position.contractType.toLowerCase().includes("lower") ? "↘" : "↗"}</span><div><strong>{position.symbol} · {position.contractType}</strong><small>Contract #{position.contractId} · {position.status}</small>{position.longcode && <small className={styles.positionDescription}>{position.longcode}</small>}</div></div>
          <div className={styles.positionNumbers}><span><small>Stake</small><strong>{money(position.buyPrice, position.currency)}</strong></span><span><small>Current P/L</small><strong className={position.profit === null ? "" : position.profit >= 0 ? styles.positive : styles.negative}>{money(position.profit, position.currency)}</strong></span></div>
        </article>)}
      </div>}
    </section>

    <section className={styles.activityPanel}>
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>ACCOUNT STATEMENT</p><h2>Recent activity</h2><p className={styles.panelSubtext}>Transactions returned by Deriv for this account.</p></div>
      </div>
      {activity.length === 0 ? <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>↺</span><strong>No transactions returned yet</strong><p>Trade purchases and other account events appear after Deriv returns a statement. This panel never uses sample trades.</p>
      </div> : <div className={styles.activityList}>
        {activity.slice(0, 20).map((item) => <article key={item.id} className={styles.activityRow}>
          <span className={styles.activityIcon}>{item.action.toLowerCase() === "buy" ? "↗" : item.action.toLowerCase() === "sell" ? "↘" : "•"}</span>
          <div className={styles.activityDetails}><strong>{actionLabel(item.action)}</strong><small>{item.description}</small><small>{dateLabel(item.time)}{item.contractId ? " · Contract #" + item.contractId : ""}</small></div>
          <div className={styles.activityAmount}><strong className={item.amount === null ? "" : item.amount < 0 ? styles.negative : styles.positive}>{money(item.amount, item.currency || currency)}</strong>{item.balance !== null && <small>Balance {money(item.balance, item.currency || currency)}</small>}</div>
        </article>)}
      </div>}
    </section>
  </div>;
}
