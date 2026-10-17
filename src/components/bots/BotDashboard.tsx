'use client';

import { useRef, useState } from 'react';
import { isBotConfig, type BotConfig, type BotRun } from './bot-types';
import { upsertBotConfig, deleteBotConfig } from './bot-storage';
import { BotConfigModal, type BotModalFields, type BotModalMode } from './BotConfigModal';
import styles from './BotDashboard.module.css';

interface BotDashboardProps {
  configs: BotConfig[];
  runs: BotRun[];
  activeConfigId: string | null;
  onSelectConfig: (id: string) => void;
  onNewConfig: (config: BotConfig) => void;
  onDeleteConfig: (id: string) => void;
  onImportConfig: (config: BotConfig) => void;
}

type RunFilter = 'all' | 'error' | 'stopped';
const RUNS_PAGE_SIZE = 8;

function defaultFields(): BotModalFields {
  return {
    name: 'My Bot',
    symbol: '1HZ100V',
    contractType: 'DIGITOVER',
    barrier: '5',
    stake: '1',
    profitTarget: '',
    lossLimit: '',
    maxTrades: '10',
  };
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function lastRunForBot(runs: BotRun[], botId: string): BotRun | undefined {
  return runs.find((r) => r.botId === botId);
}

export function BotDashboard({
  configs,
  runs,
  activeConfigId,
  onSelectConfig,
  onNewConfig,
  onDeleteConfig,
  onImportConfig,
}: BotDashboardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const botsListRef = useRef<HTMLDivElement>(null);
  const [modalMode, setModalMode] = useState<BotModalMode>(null);
  const [fields, setFields] = useState<BotModalFields>(defaultFields);
  const [importError, setImportError] = useState('');
  const [formError, setFormError] = useState('');
  const [runFilter, setRunFilter] = useState<RunFilter>('all');
  const [runSearch, setRunSearch] = useState('');
  const [showAllRuns, setShowAllRuns] = useState(false);

  const failedRuns = runs.filter((run) => run.status === 'error').length;
  const totalTrades = runs.reduce((total, run) => total + run.tradeCount, 0);
  const filteredRuns = runs.filter((run) => {
    const matchesStatus = runFilter === 'all' || run.status === runFilter;
    const matchesSearch = run.botName.toLowerCase().includes(runSearch.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });
  const visibleRuns = showAllRuns ? filteredRuns : filteredRuns.slice(0, RUNS_PAGE_SIZE);

  function openModal(mode: BotModalMode) {
    setFields(defaultFields());
    setFormError('');
    setModalMode(mode);
  }

  function closeModal() {
    setModalMode(null);
    setFormError('');
  }

  function handleFieldChange(key: keyof BotModalFields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleConfirm() {
    const name = fields.name.trim();
    if (!name) {
      setFormError('Bot name is required.');
      return;
    }
    const stake = Number(fields.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      setFormError('Stake must be a positive number.');
      return;
    }

    const contractType = fields.contractType;
    const requiresBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);
    const barrier = fields.barrier.trim();
    if (requiresBarrier && !/^\d$/.test(barrier)) {
      setFormError('Enter a target digit from 0 to 9 for this contract type.');
      return;
    }
    if (contractType === 'DIGITOVER' && Number(barrier) > 8) {
      setFormError('Digit Over barriers must be from 0 to 8.');
      return;
    }
    if (contractType === 'DIGITUNDER' && Number(barrier) < 1) {
      setFormError('Digit Under barriers must be from 1 to 9.');
      return;
    }

    const profitTarget = fields.profitTarget !== '' ? Number(fields.profitTarget) : null;
    const lossLimit = fields.lossLimit !== '' ? Number(fields.lossLimit) : null;
    const maxTrades = fields.maxTrades !== '' ? Number(fields.maxTrades) : null;
    if (profitTarget !== null && (!Number.isFinite(profitTarget) || profitTarget <= 0)) {
      setFormError('Profit target must be a positive amount.');
      return;
    }
    if (lossLimit !== null && (!Number.isFinite(lossLimit) || lossLimit <= 0)) {
      setFormError('Loss limit must be a positive amount.');
      return;
    }
    if (maxTrades !== null && (!Number.isInteger(maxTrades) || maxTrades < 1)) {
      setFormError('Max trades must be a whole number greater than zero.');
      return;
    }

    const stopConditions: BotConfig['stopConditions'] = [];
    if (profitTarget !== null) {
      stopConditions.push({ type: 'profit', target: profitTarget });
    }
    if (lossLimit !== null) {
      stopConditions.push({ type: 'loss', limit: lossLimit });
    }
    if (maxTrades !== null) {
      stopConditions.push({ type: 'tradeCount', max: maxTrades });
    }
    if (!stopConditions.some((condition) => condition.type === 'loss' || condition.type === 'tradeCount' || condition.type === 'time')) {
      setFormError('Add a loss limit or maximum trade count before saving a runnable bot.');
      return;
    }

    const config: BotConfig = {
      id: crypto.randomUUID(),
      name,
      symbol: fields.symbol,
      contractType,
      ...(requiresBarrier ? { barrier } : {}),
      duration: 5,
      durationUnit: 't',
      stakeStrategy: { type: 'fixed', amount: stake },
      stopConditions,
      cooldownSeconds: 2,
      maxTradesPerDay: 20,
      maxConsecutiveLosses: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    upsertBotConfig(config);
    onNewConfig(config);
    closeModal();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as unknown;
        if (!isBotConfig(parsed)) {
          setImportError('Invalid bot file: check the contract, symbol, barrier, duration, stake strategy, and stop-condition values.');
          return;
        }
        const config = parsed;
        upsertBotConfig(config);
        onImportConfig(config);
      } catch {
        setImportError('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be imported again
    e.target.value = '';
  }

  function handleDelete(id: string) {
    deleteBotConfig(id);
    onDeleteConfig(id);
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>AUTOMATION WORKSPACE</p>
          <h1 className={styles.pageTitle}>Bot dashboard</h1>
          <p className={styles.pageDescription}>Build, manage, and monitor your Demo trading strategies.</p>
        </div>
        <span className={styles.demoBadge}>Demo accounts only</span>
      </header>

      <div className={styles.metricGrid} aria-label="Bot activity summary">
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Saved bots</span>
          <strong className={styles.metricValue}>{configs.length}</strong>
          <span className={styles.metricHint}>Ready to configure and run</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Recorded runs</span>
          <strong className={styles.metricValue}>{runs.length}</strong>
          <span className={styles.metricHint}>{totalTrades} trades completed</span>
        </article>
        <article className={failedRuns ? `${styles.metricCard} ${styles.metricCardWarning}` : styles.metricCard}>
          <span className={styles.metricLabel}>Runs needing attention</span>
          <strong className={styles.metricValue}>{failedRuns}</strong>
          <span className={styles.metricHint}>{failedRuns ? 'Review the saved error details below' : 'No failed runs recorded'}</span>
        </article>
      </div>

      {/* Action cards */}
      <div>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionHeading}>Quick actions</h2>
            <p className={styles.sectionDescription}>Start a strategy or manage your saved bots.</p>
          </div>
        </div>
        <div className={styles.actionCards}>
          <button className={styles.actionCard} onClick={() => openModal('new')} type="button">
            <span className={styles.actionCardIcon}>⚡</span>
            <span className={styles.actionCardLabel}>New bot</span>
            <span className={styles.actionCardHint}>Set up a strategy</span>
          </button>
          <button
            className={styles.actionCard}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <span className={styles.actionCardIcon}>📂</span>
            <span className={styles.actionCardLabel}>Import bot</span>
            <span className={styles.actionCardHint}>Load a JSON config</span>
          </button>
          <button className={styles.actionCard} onClick={() => openModal('quick')} type="button">
            <span className={styles.actionCardIcon}>🎯</span>
            <span className={styles.actionCardLabel}>Quick strategy</span>
            <span className={styles.actionCardHint}>Create with guided defaults</span>
          </button>
          <button
            className={styles.actionCard}
            onClick={() => botsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            type="button"
          >
            <span className={styles.actionCardIcon}>📋</span>
            <span className={styles.actionCardLabel}>View bots</span>
            <span className={styles.actionCardHint}>Jump to your bot list</span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          aria-hidden="true"
        />
        {importError && <p className={styles.errorMsg}>{importError}</p>}
      </div>

      {/* Bot list */}
      <div ref={botsListRef} className={styles.contentSection} id="saved-bots">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionHeading}>Your bots</h2>
            <p className={styles.sectionDescription}>Select a bot to load its configuration into the run panel.</p>
          </div>
          <span className={styles.sectionCount}>{configs.length} saved</span>
        </div>
        {configs.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>⚡</span>
            <strong>No saved bots yet</strong>
            <span>Create a guided quick strategy or open Bot Builder to get started.</span>
            <button className={styles.emptyAction} onClick={() => openModal('quick')} type="button">
              Create a quick strategy
            </button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Symbol</th>
                  <th>Contract Type</th>
                  <th>Last Run</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((config) => {
                  const lastRun = lastRunForBot(runs, config.id);
                  return (
                    <tr
                      key={config.id}
                      className={config.id === activeConfigId ? styles.activeRow : undefined}
                    >
                      <td>{config.name}</td>
                      <td>{config.symbol}</td>
                      <td>{config.contractType}</td>
                      <td>
                        {lastRun ? (
                          <span className={`${styles.statusBadge} ${styles[`status_${lastRun.status}`]}`}>
                            {lastRun.status}
                          </span>
                        ) : 'No runs yet'}
                      </td>
                      <td>
                        <div className={styles.tableActions}>
                          <button
                            className={styles.selectBtn}
                            onClick={() => onSelectConfig(config.id)}
                            type="button"
                          >
                            Select
                          </button>
                          <button
                            className={styles.deleteBtn}
                            onClick={() => handleDelete(config.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent runs */}
      <div className={styles.contentSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionHeading}>Recent runs</h2>
            <p className={styles.sectionDescription}>The latest run summaries and any saved failure details.</p>
          </div>
        </div>
        {runs.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No runs recorded yet</strong>
            <span>Your completed and stopped runs will appear here.</span>
          </div>
        ) : (
          <>
            <div className={styles.runToolbar}>
              <label className={styles.searchWrap}>
                <span className={styles.srOnly}>Search runs by bot name</span>
                <input
                  className={styles.searchInput}
                  type="search"
                  value={runSearch}
                  onChange={(event) => setRunSearch(event.target.value)}
                  placeholder="Search run history"
                />
              </label>
              <div className={styles.filterGroup} aria-label="Filter runs">
                {(['all', 'error', 'stopped'] as const).map((filter) => (
                  <button
                    key={filter}
                    className={runFilter === filter ? styles.filterActive : styles.filterButton}
                    onClick={() => setRunFilter(filter)}
                    type="button"
                    aria-pressed={runFilter === filter}
                  >
                    {filter === 'all' ? 'All' : filter === 'error' ? 'Errors' : 'Stopped'}
                    {filter === 'error' && <span className={styles.filterCount}>{failedRuns}</span>}
                  </button>
                ))}
              </div>
            </div>
            {filteredRuns.length === 0 ? (
              <div className={styles.emptyState}>No runs match these filters.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Bot Name</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Trades</th>
                      <th>Win%</th>
                      <th>Net P&amp;L</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRuns.map((run, i) => {
                      const winPct =
                        run.tradeCount > 0
                          ? ((run.wins / run.tradeCount) * 100).toFixed(1) + '%'
                          : '—';
                      return (
                        <tr key={`${run.botId}-${run.startedAt}-${i}`}>
                          <td>{run.botName}</td>
                          <td>{formatDate(run.startedAt)}</td>
                          <td>{run.endedAt ? formatDate(run.endedAt) : '—'}</td>
                          <td>{run.tradeCount}</td>
                          <td>{winPct}</td>
                          <td
                            style={{
                              color: run.netPnl >= 0 ? 'var(--teal)' : 'var(--red)',
                            }}
                          >
                            {run.netPnl >= 0 ? '+' : ''}
                            {run.netPnl.toFixed(2)} {run.currency}
                          </td>
                          <td>
                            <span className={`${styles.statusBadge} ${styles[`status_${run.status}`]}`}>
                              {run.status}
                            </span>
                            {run.status === 'error' && (
                              <details className={styles.runDetails}>
                                <summary>Why?</summary>
                                <p>
                                  {run.error || 'No error details were saved for this older run. New runs will include the failure reason here.'}
                                </p>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {filteredRuns.length > RUNS_PAGE_SIZE && (
              <button
                className={styles.showRunsBtn}
                onClick={() => setShowAllRuns((current) => !current)}
                type="button"
              >
                {showAllRuns ? 'Show fewer runs' : `Show all ${filteredRuns.length} runs`}
              </button>
            )}
          </>
        )}
      </div>

      <BotConfigModal
        mode={modalMode}
        fields={fields}
        error={formError}
        onFieldChange={handleFieldChange}
        onClose={closeModal}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

export default BotDashboard;
