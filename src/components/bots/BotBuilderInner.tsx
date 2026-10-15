'use client';

import { useEffect, useRef, useState } from 'react';
import type { BotConfig } from './bot-types';
import styles from './BotBuilder.module.css';

// Blockly is browser-only; this file is only ever loaded via next/dynamic with ssr:false.
import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';

// Valid symbols for digit contracts on the authenticated session
const DIGIT_SYMBOLS: Array<[string, string]> = [
  ['Volatility 10 (1s)', '1HZ10V'],
  ['Volatility 25 (1s)', '1HZ25V'],
  ['Volatility 50 (1s)', '1HZ50V'],
  ['Volatility 75 (1s)', '1HZ75V'],
  ['Volatility 100 (1s)', '1HZ100V'],
  ['Volatility 10', 'R_10'],
  ['Volatility 25', 'R_25'],
  ['Volatility 50', 'R_50'],
  ['Volatility 75', 'R_75'],
  ['Volatility 100', 'R_100'],
];

// Cast helper: Blockly's FieldDropdown is Field<string> but appendField expects
// Field<string | undefined> — a known variance quirk in the Blockly 10.x typings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyField = any;

function registerCustomBlocks() {
  // 1. trade_parameters
  if (!Blockly.Blocks['trade_parameters']) {
    Blockly.Blocks['trade_parameters'] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField('Trade Parameters')
          .appendField('Symbol:')
          .appendField(
            new Blockly.FieldDropdown(DIGIT_SYMBOLS) as AnyField,
            'symbol'
          )
          .appendField('Contract:')
          .appendField(
            new Blockly.FieldDropdown([
              ['Digit Over', 'DIGITOVER'],
              ['Digit Under', 'DIGITUNDER'],
              ['Even', 'DIGITEVEN'],
              ['Odd', 'DIGITODD'],
              ['Matches', 'DIGITMATCH'],
              ['Differs', 'DIGITDIFF'],
            ]) as AnyField,
            'contractType'
          )
          .appendField('Duration:')
          .appendField(new Blockly.FieldNumber(5, 1, 10) as AnyField, 'duration');
        this.setColour(230);
        this.setOutput(true);
        this.setTooltip('Set the trade symbol, contract type and duration (ticks).');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (javascriptGenerator as any)['trade_parameters'] = function (block: Blockly.Block): [string, number] {
      const symbol = block.getFieldValue('symbol');
      const contractType = block.getFieldValue('contractType');
      const duration = block.getFieldValue('duration');
      const code = JSON.stringify({ symbol, contractType, duration });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [code, (Blockly as any).JavaScript?.ORDER_ATOMIC ?? 0];
    };
  }

  // 2. trade_options
  if (!Blockly.Blocks['trade_options']) {
    Blockly.Blocks['trade_options'] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField('Trade Options')
          .appendField('Stake:')
          .appendField(new Blockly.FieldNumber(1, 0.01) as AnyField, 'stake')
          .appendField('Currency:')
          .appendField(new Blockly.FieldTextInput('USD') as AnyField, 'currency');
        this.setColour(230);
        this.setOutput(true);
        this.setTooltip('Set the stake amount and currency.');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (javascriptGenerator as any)['trade_options'] = function (block: Blockly.Block): [string, number] {
      const stake = block.getFieldValue('stake');
      const currency = block.getFieldValue('currency');
      const code = JSON.stringify({ stake, currency });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [code, (Blockly as any).JavaScript?.ORDER_ATOMIC ?? 0];
    };
  }

  // 3. purchase_conditions
  if (!Blockly.Blocks['purchase_conditions']) {
    Blockly.Blocks['purchase_conditions'] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField('Purchase Conditions')
          .appendField('Condition:')
          .appendField(
            new Blockly.FieldDropdown([
              ['Always', 'always'],
              ['On signal only', 'signal'],
            ]) as AnyField,
            'condition'
          );
        this.setColour(65);
        this.setOutput(true);
        this.setTooltip('When to purchase a contract.');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (javascriptGenerator as any)['purchase_conditions'] = function (block: Blockly.Block): [string, number] {
      const condition = block.getFieldValue('condition');
      const code = JSON.stringify({ condition });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [code, (Blockly as any).JavaScript?.ORDER_ATOMIC ?? 0];
    };
  }

  // 4. restart_trading
  if (!Blockly.Blocks['restart_trading']) {
    Blockly.Blocks['restart_trading'] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField('Restart Trading')
          .appendField('On:')
          .appendField(
            new Blockly.FieldDropdown([
              ['On win', 'win'],
              ['On loss', 'loss'],
              ['Always', 'always'],
            ]) as AnyField,
            'on'
          );
        this.setColour(120);
        this.setOutput(true);
        this.setTooltip('When to restart after a trade settles.');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (javascriptGenerator as any)['restart_trading'] = function (block: Blockly.Block): [string, number] {
      const on = block.getFieldValue('on');
      const code = JSON.stringify({ on });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [code, (Blockly as any).JavaScript?.ORDER_ATOMIC ?? 0];
    };
  }

  // 5. stake_management
  if (!Blockly.Blocks['stake_management']) {
    Blockly.Blocks['stake_management'] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField('Stake Management')
          .appendField('Strategy:')
          .appendField(
            new Blockly.FieldDropdown([
              ['Fixed', 'fixed'],
              ['Martingale', 'martingale'],
              ["D'Alembert", 'dalembert'],
            ]) as AnyField,
            'strategy'
          )
          .appendField('Base:')
          .appendField(new Blockly.FieldNumber(1, 0.01) as AnyField, 'base')
          .appendField('Multiplier:')
          .appendField(new Blockly.FieldNumber(2, 1) as AnyField, 'multiplier')
          .appendField('Max Stake:')
          .appendField(new Blockly.FieldNumber(100, 0.01) as AnyField, 'maxStake');
        this.setColour(120);
        this.setOutput(true);
        this.setTooltip('Configure the stake management strategy.');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (javascriptGenerator as any)['stake_management'] = function (block: Blockly.Block): [string, number] {
      const strategy = block.getFieldValue('strategy');
      const base = parseFloat(block.getFieldValue('base'));
      const multiplier = parseFloat(block.getFieldValue('multiplier'));
      const maxStake = parseFloat(block.getFieldValue('maxStake'));
      const code = JSON.stringify({ strategy, base, multiplier, maxStake });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [code, (Blockly as any).JavaScript?.ORDER_ATOMIC ?? 0];
    };
  }

  // 6. stop_conditions
  if (!Blockly.Blocks['stop_conditions']) {
    Blockly.Blocks['stop_conditions'] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField('Stop Conditions')
          .appendField('Profit Target:')
          .appendField(new Blockly.FieldNumber(0, 0) as AnyField, 'profitTarget')
          .appendField('Loss Limit:')
          .appendField(new Blockly.FieldNumber(0, 0) as AnyField, 'lossLimit')
          .appendField('Max Trades:')
          .appendField(new Blockly.FieldNumber(0, 0) as AnyField, 'maxTrades');
        this.setColour(65);
        this.setOutput(true);
        this.setTooltip('Set profit target, loss limit and max trades. Zero disables that condition.');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (javascriptGenerator as any)['stop_conditions'] = function (block: Blockly.Block): [string, number] {
      const profitTarget = parseFloat(block.getFieldValue('profitTarget'));
      const lossLimit = parseFloat(block.getFieldValue('lossLimit'));
      const maxTrades = parseInt(block.getFieldValue('maxTrades'), 10);
      const code = JSON.stringify({ profitTarget, lossLimit, maxTrades });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [code, (Blockly as any).JavaScript?.ORDER_ATOMIC ?? 0];
    };
  }
}

// ─── Toolbox definition ────────────────────────────────────────────────────

const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Trade Setup',
      colour: '230',
      contents: [
        { kind: 'block', type: 'trade_parameters' },
        { kind: 'block', type: 'trade_options' },
      ],
    },
    {
      kind: 'category',
      name: 'Money Management',
      colour: '120',
      contents: [
        { kind: 'block', type: 'stake_management' },
        { kind: 'block', type: 'restart_trading' },
      ],
    },
    {
      kind: 'category',
      name: 'Conditions',
      colour: '65',
      contents: [
        { kind: 'block', type: 'purchase_conditions' },
        { kind: 'block', type: 'stop_conditions' },
      ],
    },
    {
      kind: 'category',
      name: 'Logic',
      colour: '210',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'math_arithmetic' },
      ],
    },
  ],
};

// ─── workspaceToBotConfig ──────────────────────────────────────────────────

function workspaceToBotConfig(
  ws: Blockly.WorkspaceSvg,
  name: string
): BotConfig | null {
  const blocks = ws.getAllBlocks(false);

  const tradeParams = blocks.find((b) => b.type === 'trade_parameters');
  if (!tradeParams) return null;

  const symbol: string = tradeParams.getFieldValue('symbol') ?? '1HZ100V';
  const contractType: string = tradeParams.getFieldValue('contractType') ?? 'DIGITOVER';
  const duration: number = parseFloat(tradeParams.getFieldValue('duration') ?? '5') || 5;

  // trade_options
  const tradeOpts = blocks.find((b) => b.type === 'trade_options');
  const stake: number = tradeOpts
    ? parseFloat(tradeOpts.getFieldValue('stake') ?? '1') || 1
    : 1;

  // stake_management
  const stakeMgmt = blocks.find((b) => b.type === 'stake_management');
  let stakeStrategy: BotConfig['stakeStrategy'];
  if (stakeMgmt) {
    const stratType = stakeMgmt.getFieldValue('strategy');
    const base = parseFloat(stakeMgmt.getFieldValue('base') ?? '1') || 1;
    const multiplier = parseFloat(stakeMgmt.getFieldValue('multiplier') ?? '2') || 2;
    const maxStake = parseFloat(stakeMgmt.getFieldValue('maxStake') ?? '100') || 100;
    if (stratType === 'martingale') {
      stakeStrategy = { type: 'martingale', base, multiplier, maxStake };
    } else if (stratType === 'dalembert') {
      stakeStrategy = { type: 'dalembert', unit: base, maxStake };
    } else {
      stakeStrategy = { type: 'fixed', amount: stake };
    }
  } else {
    stakeStrategy = { type: 'fixed', amount: stake };
  }

  // stop_conditions
  const stopBlock = blocks.find((b) => b.type === 'stop_conditions');
  const stopConditions: BotConfig['stopConditions'] = [];
  if (stopBlock) {
    const profitTarget = parseFloat(stopBlock.getFieldValue('profitTarget') ?? '0');
    const lossLimit = parseFloat(stopBlock.getFieldValue('lossLimit') ?? '0');
    const maxTrades = parseInt(stopBlock.getFieldValue('maxTrades') ?? '0', 10);
    if (profitTarget > 0) stopConditions.push({ type: 'profit', target: profitTarget });
    if (lossLimit > 0) stopConditions.push({ type: 'loss', limit: lossLimit });
    if (maxTrades > 0) stopConditions.push({ type: 'tradeCount', max: maxTrades });
  }

  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    symbol,
    contractType,
    duration,
    durationUnit: 't',
    stakeStrategy,
    stopConditions,
    cooldownSeconds: 2,
    maxTradesPerDay: 50,
    maxConsecutiveLosses: 5,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────

interface BotBuilderInnerProps {
  onSaveConfig: (config: BotConfig) => void;
}

export function BotBuilderInner({ onSaveConfig }: BotBuilderInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const [botName, setBotName] = useState('My Bot');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;

    registerCustomBlocks();

    // Define dark theme
    const darkTheme = Blockly.Theme.defineTheme('tradebridgeDark', {
      name: 'tradebridgeDark',
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: '#0b1320',
        toolboxBackgroundColour: '#131c2e',
        toolboxForegroundColour: '#f1f5f9',
        flyoutBackgroundColour: '#1a2438',
        flyoutForegroundColour: '#f1f5f9',
        insertionMarkerColour: '#10b981',
        scrollbarColour: '#334155',
        scrollbarOpacity: 0.8,
      },
    });

    const ws = Blockly.inject(containerRef.current, {
      toolbox: TOOLBOX,
      theme: darkTheme,
      trashcan: true,
      scrollbars: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 1.0,
      },
    });

    workspaceRef.current = ws;

    return () => {
      ws.dispose();
      workspaceRef.current = null;
    };
  }, []);

  function handleSave() {
    setStatusMsg('');
    setErrorMsg('');
    if (!workspaceRef.current) {
      setErrorMsg('Workspace not ready.');
      return;
    }
    const config = workspaceToBotConfig(workspaceRef.current, botName.trim() || 'My Bot');
    if (!config) {
      setErrorMsg('Add a Trade Setup block first.');
      return;
    }
    onSaveConfig(config);
    setStatusMsg('Bot saved.');
  }

  function handleClear() {
    if (workspaceRef.current) {
      workspaceRef.current.clear();
    }
    setStatusMsg('');
    setErrorMsg('');
  }

  return (
    <div className={styles.builder}>
      <div className={styles.toolbar}>
        <input
          className={styles.nameInput}
          type="text"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          placeholder="Bot name"
          aria-label="Bot name"
        />
        <button className={styles.toolbarButton} onClick={handleClear} type="button">
          Clear
        </button>
        <button className={`${styles.toolbarButton} ${styles.saveButton}`} onClick={handleSave} type="button">
          Save Bot
        </button>
        {statusMsg && <span className={styles.statusMsg}>{statusMsg}</span>}
        {errorMsg && <span className={styles.errorMsg}>{errorMsg}</span>}
      </div>
      <div
        ref={containerRef}
        className={styles.blocklyContainer}
        style={{ width: '100%', height: '100%', minHeight: '460px' }}
      />
    </div>
  );
}

export default BotBuilderInner;
