'use client';

import { useState } from 'react';
import type { BotRunState, BotConfig, BotStatus, JournalEntry } from './bot-types';
import styles from './RunPanel.module.css';

interface RunPanelProps {
  runState: BotRunState;
  onStart: () => void;
  onStop: () => void;
  orderRecoveryRequired: boolean;
  onAcknowledgeOrderReconciled?: () => void;
  config: BotConfig | null;
}

type ActiveTab = 'summary' | 'transactions' | 'journal';

const IDLE_STATUSES: BotStatus[] = ['idle', 'stopped', 'error'];
const ACTIVE_STATUSES: BotStatus[] = ['running', 'cooldown', 'connecting', 'stopping'];

function levelClass(level: JournalEntry['level'], styles: Record<string, string>): string {
  if (level === 'warn') return styles.journalWarn;
  if (level === 'error') return styles.journalError;
  return styles.journalInfo;
}

export function RunPanel({ runState, onStart, onStop, orderRecoveryRequired, onAcknowledgeOrderReconciled, config }: RunPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('summary');

  const {
    status,
    tradeCount,
    wins,
    losses,
    netPnl,
    currency,
    transactions,
    journal,
  } = runState;

  const winRate =
    tradeCount > 0 ? ((wins / tradeCount) * 100).toFixed(1) + '%' : '—';

  const canRun = IDLE_STATUSES.includes(status) && config !== null && !orderRecoveryRequired;
  const isActive = ACTIVE_STATUSES.includes(status);

  return (
    <div className={styles.runPanel}>
      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist" aria-label="Run panel tabs">
        {(['summary', 'transactions', 'journal'] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            id={`run-tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls="run-tabpanel"
            className={activeTab === tab ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div
        id="run-tabpanel"
        className={styles.tabContent}
        role="tabpanel"
        aria-labelledby={`run-tab-${activeTab}`}
      >
        {activeTab === 'summary' && (
          <>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>STATUS</div>
                <div className={styles.statValue}>{status.toUpperCase()}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>TRADES</div>
                <div className={styles.statValue}>{tradeCount}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>WINS</div>
                <div className={styles.statValue}>{wins}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>LOSSES</div>
                <div className={styles.statValue}>{losses}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>WIN RATE</div>
                <div className={styles.statValue}>{winRate}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>NET P&amp;L</div>
                <div
                  className={styles.statValue}
                  style={{ color: netPnl >= 0 ? 'var(--teal)' : 'var(--red)' }}
                >
                  {netPnl >= 0 ? '+' : ''}
                  {netPnl.toFixed(2)} {currency}
                </div>
              </div>
            </div>

            {canRun && (
              <button className={styles.runButton} onClick={onStart}>
                ▶ Run Bot
              </button>
            )}
            {isActive && (
              <button className={styles.stopButton} onClick={onStop}>
                ■ Stop Bot
              </button>
            )}
            {orderRecoveryRequired && !isActive && (
              <div role="alert" className={styles.emptyState}>
                <p>An order outcome is unresolved. Check Deriv open contracts and account history. This server-side safety lock cannot be cleared by a browser acknowledgement.</p>
                {onAcknowledgeOrderReconciled && (
                  <button className={styles.stopButton} onClick={onAcknowledgeOrderReconciled}>
                    Refresh reconciliation status
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'transactions' && (
          <>
            {transactions.length === 0 ? (
              <div className={styles.emptyState}>No transactions yet</div>
            ) : (
              <table className={styles.txTable}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Type</th>
                    <th>Stake</th>
                    <th>Payout</th>
                    <th>Profit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>{new Date(tx.startedAt).toLocaleTimeString()}</td>
                      <td>{tx.symbol}</td>
                      <td>{tx.contractType}</td>
                      <td>
                        {tx.stake.toFixed(2)} {tx.currency}
                      </td>
                      <td>
                        {tx.payout !== null
                          ? `${tx.payout.toFixed(2)} ${tx.currency}`
                          : '—'}
                      </td>
                      <td
                        style={{
                          color:
                            tx.profit === null
                              ? undefined
                              : tx.profit >= 0
                              ? 'var(--teal)'
                              : 'var(--red)',
                        }}
                      >
                        {tx.profit !== null
                          ? `${tx.profit >= 0 ? '+' : ''}${tx.profit.toFixed(2)}`
                          : '—'}
                      </td>
                      <td>{tx.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'journal' && (
          <>
            {journal.length === 0 ? (
              <div className={styles.emptyState}>No journal entries yet</div>
            ) : (
              <ul className={styles.journalList} aria-label="Bot journal">
                {journal.map((entry, i) => (
                  <li key={i} className={styles.journalItem}>
                    <span className={styles.journalTime}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={levelClass(entry.level, styles as Record<string, string>)}>
                      {entry.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default RunPanel;
