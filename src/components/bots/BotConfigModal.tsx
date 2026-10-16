'use client';

import styles from './BotDashboard.module.css';

export type BotModalMode = 'new' | 'quick' | null;

export interface BotModalFields {
  name: string;
  symbol: string;
  contractType: string;
  barrier: string;
  stake: string;
  profitTarget: string;
  lossLimit: string;
  maxTrades: string;
}

interface BotConfigModalProps {
  mode: BotModalMode;
  fields: BotModalFields;
  error: string;
  onFieldChange: (key: keyof BotModalFields, value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function BotConfigModal({ mode, fields, error, onFieldChange, onClose, onConfirm }: BotConfigModalProps) {
  if (mode === null) return null;

  return (
    <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Create Bot">
      <div className={styles.modalBox}>
        <h3 className={styles.modalTitle}>
          {mode === 'quick' ? 'Quick Strategy' : 'New Bot'}
        </h3>

        <div>
          <label className={styles.fieldLabel} htmlFor="bd-name">Bot Name</label>
          <input
            id="bd-name"
            className={styles.fieldInput}
            type="text"
            value={fields.name}
            onChange={(event) => onFieldChange('name', event.target.value)}
          />
        </div>

        <div>
          <label className={styles.fieldLabel} htmlFor="bd-symbol">Symbol</label>
          <select
            id="bd-symbol"
            className={styles.fieldSelect}
            value={fields.symbol}
            onChange={(event) => onFieldChange('symbol', event.target.value)}
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
          <label className={styles.fieldLabel} htmlFor="bd-contract-type">Contract Type</label>
          <select
            id="bd-contract-type"
            className={styles.fieldSelect}
            value={fields.contractType}
            onChange={(event) => onFieldChange('contractType', event.target.value)}
          >
            <option value="DIGITOVER">Digit Over</option>
            <option value="DIGITUNDER">Digit Under</option>
            <option value="DIGITEVEN">Even</option>
            <option value="DIGITODD">Odd</option>
            <option value="DIGITMATCH">Matches</option>
            <option value="DIGITDIFF">Differs</option>
          </select>
        </div>

        {['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(fields.contractType) && (
          <div>
            <label className={styles.fieldLabel} htmlFor="bd-barrier">
              {fields.contractType === 'DIGITOVER' || fields.contractType === 'DIGITUNDER'
                ? 'Barrier digit'
                : 'Target digit'}
            </label>
            <input
              id="bd-barrier"
              className={styles.fieldInput}
              type="number"
              min={fields.contractType === 'DIGITUNDER' ? 1 : 0}
              max={fields.contractType === 'DIGITOVER' ? 8 : 9}
              step="1"
              value={fields.barrier}
              onChange={(event) => onFieldChange('barrier', event.target.value)}
              aria-describedby="bd-barrier-hint"
            />
            <span id="bd-barrier-hint" className={styles.fieldHint}>
              {fields.contractType === 'DIGITOVER'
                ? 'Choose 0 to 8.'
                : fields.contractType === 'DIGITUNDER'
                  ? 'Choose 1 to 9.'
                  : 'Choose a digit from 0 to 9.'}
            </span>
          </div>
        )}

        <div>
          <label className={styles.fieldLabel} htmlFor="bd-stake">Stake</label>
          <input
            id="bd-stake"
            className={styles.fieldInput}
            type="number"
            min="0.01"
            step="0.01"
            value={fields.stake}
            onChange={(event) => onFieldChange('stake', event.target.value)}
          />
        </div>

        <div>
          <label className={styles.fieldLabel} htmlFor="bd-profit-target">Profit Target (optional)</label>
          <input
            id="bd-profit-target"
            className={styles.fieldInput}
            type="number"
            min="0"
            step="0.01"
            value={fields.profitTarget}
            onChange={(event) => onFieldChange('profitTarget', event.target.value)}
            placeholder="Leave blank to disable"
          />
        </div>

        <div>
          <label className={styles.fieldLabel} htmlFor="bd-loss-limit">Loss Limit (optional)</label>
          <input
            id="bd-loss-limit"
            className={styles.fieldInput}
            type="number"
            min="0"
            step="0.01"
            value={fields.lossLimit}
            onChange={(event) => onFieldChange('lossLimit', event.target.value)}
            placeholder="Leave blank to disable"
          />
        </div>

        <div>
          <label className={styles.fieldLabel} htmlFor="bd-max-trades">Max Trades (optional)</label>
          <input
            id="bd-max-trades"
            className={styles.fieldInput}
            type="number"
            min="1"
            step="1"
            value={fields.maxTrades}
            onChange={(event) => onFieldChange('maxTrades', event.target.value)}
            placeholder="Leave blank to disable"
          />
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">Cancel</button>
          <button className={styles.confirmBtn} onClick={onConfirm} type="button">
            Create Bot
          </button>
        </div>
      </div>
    </div>
  );
}