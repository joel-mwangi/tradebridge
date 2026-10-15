'use client';

import { useRef, useState } from 'react';
import type { BotConfig, BotRun } from './bot-types';
import { upsertBotConfig, deleteBotConfig } from './bot-storage';
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

type ModalMode = 'new' | 'quick' | null;

interface ModalFields {
  name: string;
  symbol: string;
  contractType: string;
  stake: string;
  profitTarget: string;
  lossLimit: string;
  maxTrades: string;
}

function defaultFields(): ModalFields {
  return {
    name: 'My Bot',
    symbol: '1HZ100V',
    contractType: 'DIGITOVER',
    stake: '1',
    profitTarget: '',
    lossLimit: '',
    maxTrades: '',
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
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [fields, setFields] = useState<ModalFields>(defaultFields);
  const [importError, setImportError] = useState('');
  const [formError, setFormError] = useState('');

  function openModal(mode: ModalMode) {
    setFields(defaultFields());
    setFormError('');
    setModalMode(mode);
  }

  function closeModal() {
    setModalMode(null);
    setFormError('');
  }

  function handleFieldChange(key: keyof ModalFields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleConfirm() {
    const name = fields.name.trim();
    if (!name) {
      setFormError('Bot name is required.');
      return;
    }
    const stake = parseFloat(fields.stake);
    if (isNaN(stake) || stake <= 0) {
      setFormError('Stake must be a positive number.');
      return;
    }

    const profitTarget = fields.profitTarget !== '' ? parseFloat(fields.profitTarget) : null;
    const lossLimit = fields.lossLimit !== '' ? parseFloat(fields.lossLimit) : null;
    const maxTrades = fields.maxTrades !== '' ? parseInt(fields.maxTrades, 10) : null;

    const stopConditions: BotConfig['stopConditions'] = [];
    if (profitTarget !== null && !isNaN(profitTarget)) {
      stopConditions.push({ type: 'profit', target: profitTarget });
    }
    if (lossLimit !== null && !isNaN(lossLimit)) {
      stopConditions.push({ type: 'loss', limit: lossLimit });
    }
    if (maxTrades !== null && !isNaN(maxTrades)) {
      stopConditions.push({ type: 'tradeCount', max: maxTrades });
    }

    const config: BotConfig = {
      id: crypto.randomUUID(),
      name,
      symbol: fields.symbol,
      contractType: fields.contractType,
      duration: 5,
      durationUnit: 't',
      stakeStrategy: { type: 'fixed', amount: stake },
      stopConditions,
      cooldownSeconds: 2,
      maxTradesPerDay: 50,
      maxConsecutiveLosses: 5,
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
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof (parsed as Record<string, unknown>).id !== 'string' ||
          typeof (parsed as Record<string, unknown>).name !== 'string' ||
          typeof (parsed as Record<string, unknown>).symbol !== 'string'
        ) {
          setImportError('Invalid bot file: must have id, name, and symbol fields.');
          return;
        }
        const config = parsed as BotConfig;
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
      {/* Action cards */}
      <div>
        <h2 className={styles.sectionHeading}>Quick Actions</h2>
        <div className={styles.actionCards}>
          <button className={styles.actionCard} onClick={() => openModal('new')} type="button">
            <span className={styles.actionCardIcon}>⚡</span>
            <span className={styles.actionCardLabel}>New Bot</span>
          </button>
          <button
            className={styles.actionCard}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <span className={styles.actionCardIcon}>📂</span>
            <span className={styles.actionCardLabel}>Import Bot</span>
          </button>
          <button className={styles.actionCard} onClick={() => openModal('quick')} type="button">
            <span className={styles.actionCardIcon}>🎯</span>
            <span className={styles.actionCardLabel}>Quick Strategy</span>
          </button>
          <button className={styles.actionCard} type="button">
            <span className={styles.actionCardIcon}>📋</span>
            <span className={styles.actionCardLabel}>View Bots</span>
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
      <div>
        <h2 className={styles.sectionHeading}>Your Bots</h2>
        {configs.length === 0 ? (
          <div className={styles.emptyState}>
            No bots yet. Create your first bot using the Bot Builder or Quick Strategy.
          </div>
        ) : (
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
                    <td>{lastRun ? lastRun.status : '—'}</td>
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
        )}
      </div>

      {/* Recent runs */}
      <div>
        <h2 className={styles.sectionHeading}>Recent Runs</h2>
        {runs.length === 0 ? (
          <div className={styles.emptyState}>No runs recorded yet.</div>
        ) : (
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
              {runs.map((run, i) => {
                const winPct =
                  run.tradeCount > 0
                    ? ((run.wins / run.tradeCount) * 100).toFixed(1) + '%'
                    : '—';
                return (
                  <tr key={`${run.botId}-${i}`}>
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
                    <td>{run.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick-strategy / New Bot modal */}
      {modalMode !== null && (
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Create Bot">
          <div className={styles.modalBox}>
            <h3 className={styles.modalTitle}>
              {modalMode === 'quick' ? 'Quick Strategy' : 'New Bot'}
            </h3>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-name">
                Bot Name
              </label>
              <input
                id="bd-name"
                className={styles.fieldInput}
                type="text"
                value={fields.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
              />
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-symbol">
                Symbol
              </label>
              <select
                id="bd-symbol"
                className={styles.fieldSelect}
                value={fields.symbol}
                onChange={(e) => handleFieldChange('symbol', e.target.value)}
              >
                <optgroup label="Volatility (1s)">
                  <option value="1HZ10V">Volatility 10 (1s)</option>
                  <option value="1HZ25V">Volatility 25 (1s)</option>
                  <option value="1HZ50V">Volatility 50 (1s)</option>
                  <option value="1HZ75V">Volatility 75 (1s)</option>
                  <option value="1HZ100V">Volatility 100 (1s)</option>
                </optgroup>
                <optgroup label="Volatility">
                  <option value="R_10">Volatility 10</option>
                  <option value="R_25">Volatility 25</option>
                  <option value="R_50">Volatility 50</option>
                  <option value="R_75">Volatility 75</option>
                  <option value="R_100">Volatility 100</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-contract-type">
                Contract Type
              </label>
              <select
                id="bd-contract-type"
                className={styles.fieldSelect}
                value={fields.contractType}
                onChange={(e) => handleFieldChange('contractType', e.target.value)}
              >
                <option value="DIGITOVER">Digit Over</option>
                <option value="DIGITUNDER">Digit Under</option>
                <option value="DIGITEVEN">Even</option>
                <option value="DIGITODD">Odd</option>
                <option value="DIGITMATCH">Matches</option>
                <option value="DIGITDIFF">Differs</option>
              </select>
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-stake">
                Stake
              </label>
              <input
                id="bd-stake"
                className={styles.fieldInput}
                type="number"
                min="0.01"
                step="0.01"
                value={fields.stake}
                onChange={(e) => handleFieldChange('stake', e.target.value)}
              />
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-profit-target">
                Profit Target (optional)
              </label>
              <input
                id="bd-profit-target"
                className={styles.fieldInput}
                type="number"
                min="0"
                step="0.01"
                value={fields.profitTarget}
                onChange={(e) => handleFieldChange('profitTarget', e.target.value)}
                placeholder="Leave blank to disable"
              />
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-loss-limit">
                Loss Limit (optional)
              </label>
              <input
                id="bd-loss-limit"
                className={styles.fieldInput}
                type="number"
                min="0"
                step="0.01"
                value={fields.lossLimit}
                onChange={(e) => handleFieldChange('lossLimit', e.target.value)}
                placeholder="Leave blank to disable"
              />
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="bd-max-trades">
                Max Trades (optional)
              </label>
              <input
                id="bd-max-trades"
                className={styles.fieldInput}
                type="number"
                min="1"
                step="1"
                value={fields.maxTrades}
                onChange={(e) => handleFieldChange('maxTrades', e.target.value)}
                placeholder="Leave blank to disable"
              />
            </div>

            {formError && <p className={styles.errorMsg}>{formError}</p>}

            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={closeModal} type="button">
                Cancel
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirm} type="button">
                Create Bot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BotDashboard;
