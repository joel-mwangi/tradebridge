'use client';

import { useEffect, useState } from 'react';
import type { BotConfig, BotRun } from './bot-types';
import {
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
}

export function BotsWorkspace({ connected, account }: BotsWorkspaceProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>('dashboard');
  const [configs, setConfigs] = useState<BotConfig[]>([]);
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);

  // Load from storage on mount
  useEffect(() => {
    setConfigs(loadBotConfigs());
    setRuns(loadBotRuns());
  }, []);

  const activeConfig = configs.find((c) => c.id === activeConfigId) ?? null;
  const { runState, start, stop } = useBotRunner(connected, account, activeConfig);

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
            config={activeConfig}
          />
        </aside>
      </div>
    </section>
  );
}

export default BotsWorkspace;
