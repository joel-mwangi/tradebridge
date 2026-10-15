'use client';

import { useEffect, useRef, useState } from 'react';
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

type InnerTab = 'dashboard' | 'builder';

interface BotsWorkspaceProps {
  connected: boolean;
  account: DerivAccount | null;
  sharedSocketRef: React.RefObject<WebSocket | null>;
  nextSharedSeqId: () => number;
  sessionState: string;
}

export function BotsWorkspace({
  connected, account, sharedSocketRef, nextSharedSeqId, sessionState,
}: BotsWorkspaceProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>('dashboard');
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
