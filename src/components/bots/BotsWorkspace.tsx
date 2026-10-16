'use client';

import { useEffect, useState } from 'react';
import type { BotConfig, BotRun } from './bot-types';
import {
  BOT_RUNS_STORAGE_KEY,
  BOT_RUNS_UPDATED_EVENT,
  clearBotRuns,
  loadBotConfigs,
  loadBotRuns,
  upsertBotConfig,
  deleteBotConfig,
} from './bot-storage';
import { useBotRunner } from './useBotRunner';
import { RunPanel } from './RunPanel';
import { BotDashboard } from './BotDashboard';
import { BotBuilder } from './BotBuilder';
import type { DerivAccount } from '../trading/types';
import styles from '../trading/TradingWorkspace.module.css';

type InnerTab = 'dashboard' | 'builder' | 'ai';
type AILabSection = 'market' | 'testing' | 'risk';

interface BotsWorkspaceProps {
  connected: boolean;
  account: DerivAccount | null;
  sharedSocketRef: React.RefObject<WebSocket | null>;
  nextSharedSeqId: () => number;
  sessionState: string;
}

const aiTabStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px',
  background: 'transparent', color: 'var(--muted)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
};
const aiTabActiveStyle: React.CSSProperties = {
  ...aiTabStyle, borderColor: 'var(--accent, #16a085)',
  background: 'var(--surface, rgba(22,160,133,0.12))', color: 'var(--foreground, inherit)',
};
const aiContentStyle: React.CSSProperties = { display: 'grid', gap: 16 };
const aiHeadingStyle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700 };
const aiDescriptionStyle: React.CSSProperties = { margin: '6px 0 0', color: 'var(--muted)', fontSize: 12, lineHeight: 1.65 };
const aiGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 };
const aiCardStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--card, transparent)', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 150 };
const aiStatusStyle: React.CSSProperties = { marginTop: 'auto', paddingTop: 10, color: 'var(--muted)', fontSize: 11 };
const aiNoticeStyle: React.CSSProperties = { margin: 0, border: '1px solid var(--border)', borderRadius: 10, padding: 12, color: 'var(--muted)', fontSize: 12, lineHeight: 1.6 };

export function BotsWorkspace({
  connected, account, sharedSocketRef, nextSharedSeqId, sessionState,
}: BotsWorkspaceProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>('dashboard');
  const [aiSection, setAiSection] = useState<AILabSection>('market');
  const [configs, setConfigs] = useState<BotConfig[]>([]);
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);

  useEffect(() => {
    setConfigs(loadBotConfigs());
    const syncRuns = () => setRuns(loadBotRuns());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === BOT_RUNS_STORAGE_KEY) syncRuns();
    };

    syncRuns();
    window.addEventListener(BOT_RUNS_UPDATED_EVENT, syncRuns);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(BOT_RUNS_UPDATED_EVENT, syncRuns);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const activeConfig = configs.find((c) => c.id === activeConfigId) ?? null;
  const { runState, start, stop, orderRecoveryRequired, acknowledgeOrderReconciled } = useBotRunner(
    connected, account, activeConfig, sharedSocketRef, nextSharedSeqId, sessionState,
  );

  function handleSaveConfig(config: BotConfig) {
    upsertBotConfig(config);
    setConfigs((prev) => {
      const idx = prev.findIndex((c) => c.id === config.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = config;
        return next;
      }
      return [...prev, config];
    });
    setActiveConfigId(config.id);
  }

  function handleDeleteConfig(id: string) {
    deleteBotConfig(id);
    setConfigs((prev) => prev.filter((c) => c.id !== id));
    if (activeConfigId === id) setActiveConfigId(null);
  }

  function handleImportConfig(config: BotConfig) {
    upsertBotConfig(config);
    setConfigs((prev) => {
      const idx = prev.findIndex((c) => c.id === config.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = config;
        return next;
      }
      return [...prev, config];
    });
  }

  function handleSelectConfig(id: string) {
    setActiveConfigId(id);
  }

  function handleNewConfig(config: BotConfig) {
    handleSaveConfig(config);
  }

  function handleClearRuns() {
    if (!clearBotRuns()) return false;
    setRuns([]);
    return true;
  }

  return (
    <section className={styles.botsPage} aria-label="Automated bots">
      {/* Inner tab bar */}
      <div className={styles.tabNavWrap}>
        <div className={styles.workspaceTabs} role="tablist">
          <button
            role="tab"
            aria-selected={innerTab === 'dashboard'}
            className={
              innerTab === 'dashboard'
                ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
                : styles.workspaceTab
            }
            onClick={() => setInnerTab('dashboard')}
          >
            <span className={styles.workspaceTabIcon}>📋</span>
            Dashboard
          </button>
          <button
            role="tab"
            aria-selected={innerTab === 'builder'}
            className={
              innerTab === 'builder'
                ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
                : styles.workspaceTab
            }
            onClick={() => setInnerTab('builder')}
          >
            <span className={styles.workspaceTabIcon}>🧩</span>
            Bot Builder
          </button>
          <button
            role="tab"
            aria-selected={innerTab === 'ai'}
            className={
              innerTab === 'ai'
                ? `${styles.workspaceTab} ${styles.workspaceTabActive}`
                : styles.workspaceTab
            }
            onClick={() => setInnerTab('ai')}
          >
            <span className={styles.workspaceTabIcon}>🧠</span>
            AI Lab
          </button>
        </div>
      </div>

      {/* Layout: main content + run panel */}
      <div className={styles.botsLayout}>
        <div className={styles.workspaceTabPanel} role="tabpanel">
          {innerTab === 'dashboard' && (
            <BotDashboard
              configs={configs}
              runs={runs}
              activeConfigId={activeConfigId}
              onSelectConfig={handleSelectConfig}
              onNewConfig={handleNewConfig}
              onDeleteConfig={handleDeleteConfig}
              onImportConfig={handleImportConfig}
              onClearRuns={handleClearRuns}
            />
          )}
          {innerTab === 'builder' && (
            <BotBuilder onSaveConfig={handleSaveConfig} />
          )}
          {innerTab === 'ai' && (
            <section aria-label="AI Lab" style={{ display: 'grid', gap: 20 }}>
              <header style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ fontSize: 24 }}>🧠</span>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>AI Lab</h2>
                  <span style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 999, padding: '4px 8px', color: 'var(--muted)' }}>Research only</span>
                </div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  Investigate market data, evaluate strategies, and review risk evidence. This workspace does not place trades.
                </p>
              </header>

              <div role="tablist" aria-label="AI Lab sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <button type="button" role="tab" aria-selected={aiSection === 'market'} onClick={() => setAiSection('market')} style={aiSection === 'market' ? aiTabActiveStyle : aiTabStyle}>📊 Market Analysis</button>
                <button type="button" role="tab" aria-selected={aiSection === 'testing'} onClick={() => setAiSection('testing')} style={aiSection === 'testing' ? aiTabActiveStyle : aiTabStyle}>🧪 Strategy Testing</button>
                <button type="button" role="tab" aria-selected={aiSection === 'risk'} onClick={() => setAiSection('risk')} style={aiSection === 'risk' ? aiTabActiveStyle : aiTabStyle}>🛡️ Risk &amp; Evidence</button>
              </div>

              {aiSection === 'market' && (
                <div style={aiContentStyle}>
                  <div>
                    <h3 style={aiHeadingStyle}>Market Analysis</h3>
                    <p style={aiDescriptionStyle}>Digit distributions, tick statistics, and sample sizes from validated market history.</p>
                  </div>
                  <div style={aiGridStyle}>
                    <div style={aiCardStyle}><strong>Digit distributions</strong><p style={aiDescriptionStyle}>Measure observed frequency for digits 0–9 and compare it with an appropriate baseline.</p><span style={aiStatusStyle}>Awaiting connected tick data</span></div>
                    <div style={aiCardStyle}><strong>Tick statistics</strong><p style={aiDescriptionStyle}>Review sample window, missing or invalid ticks, and distribution summaries.</p><span style={aiStatusStyle}>Data source not connected</span></div>
                    <div style={aiCardStyle}><strong>Sample quality</strong><p style={aiDescriptionStyle}>Show the number of observations and data-quality warnings before drawing conclusions.</p><span style={aiStatusStyle}>No live results shown</span></div>
                  </div>
                  <p style={aiNoticeStyle}>Analysis service integration is not wired into this screen yet. No market statistics or predictions are being fabricated.</p>
                </div>
              )}

              {aiSection === 'testing' && (
                <div style={aiContentStyle}>
                  <div>
                    <h3 style={aiHeadingStyle}>Strategy Testing</h3>
                    <p style={aiDescriptionStyle}>Replay historical ticks, compare contract rules, and reserve separate unseen data for evaluation.</p>
                  </div>
                  <div style={aiGridStyle}>
                    <div style={aiCardStyle}><strong>Historical backtests</strong><p style={aiDescriptionStyle}>Define a strategy and replay historical observations with payout assumptions and fees.</p><span style={aiStatusStyle}>Backtest runner not connected</span></div>
                    <div style={aiCardStyle}><strong>Out-of-sample results</strong><p style={aiDescriptionStyle}>Evaluate on a later, untouched period to reduce overfitting and data leakage.</p><span style={aiStatusStyle}>No test results yet</span></div>
                    <div style={aiCardStyle}><strong>Baseline comparison</strong><p style={aiDescriptionStyle}>Compare results against simple baselines, including a no-edge or random benchmark where appropriate.</p><span style={aiStatusStyle}>Awaiting test engine</span></div>
                  </div>
                  <p style={aiNoticeStyle}>A strategy will not be labelled successful from an in-sample result alone. This panel is currently a UI scaffold.</p>
                </div>
              )}

              {aiSection === 'risk' && (
                <div style={aiContentStyle}>
                  <div>
                    <h3 style={aiHeadingStyle}>Risk &amp; Evidence</h3>
                    <p style={aiDescriptionStyle}>Assess uncertainty, drawdown, and the strength of evidence before considering any strategy for use.</p>
                  </div>
                  <div style={aiGridStyle}>
                    <div style={aiCardStyle}><strong>Uncertainty</strong><p style={aiDescriptionStyle}>Show sample size, confidence intervals where suitable, and limitations of statistical tests.</p><span style={aiStatusStyle}>Awaiting analysis results</span></div>
                    <div style={aiCardStyle}><strong>Drawdown &amp; exposure</strong><p style={aiDescriptionStyle}>Track losing streaks, stake exposure, and peak-to-trough losses during simulation.</p><span style={aiStatusStyle}>Risk metrics not connected</span></div>
                    <div style={aiCardStyle}><strong>Evidence review</strong><p style={aiDescriptionStyle}>Record assumptions, baseline comparisons, out-of-sample performance, and reasons to reject a strategy.</p><span style={aiStatusStyle}>Evidence ledger not connected</span></div>
                  </div>
                  <p style={aiNoticeStyle}>Historical digit frequency alone does not establish that the next outcome is predictable. Any future signal must be validated on unseen data.</p>
                </div>
              )}
            </section>
          )}
        </div>
        <aside>
          <RunPanel
            runState={runState}
            onStart={start}
            onStop={stop}
            orderRecoveryRequired={orderRecoveryRequired}
            onAcknowledgeOrderReconciled={acknowledgeOrderReconciled}
            config={activeConfig}
          />
        </aside>
      </div>
    </section>
  );
}

export default BotsWorkspace;
