'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DerivAccount } from '../trading/types';
import type {
  BotConfig,
  BotRunState,
  BotTransaction,
  JournalEntry,
  BotStatus,
  StakeStrategy,
} from './bot-types';
import { saveNewRun } from './bot-storage';

function makeInitialState(currency: string): BotRunState {
  return {
    status: 'idle',
    currentStake: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
    netPnl: 0,
    currency,
    transactions: [],
    journal: [],
    startedAt: null,
    lastError: null,
  };
}

function nextStakeAmount(
  strategy: StakeStrategy,
  lastProfit: number | null,
  prevStake: number
): number {
  switch (strategy.type) {
    case 'fixed':
      return strategy.amount;

    case 'martingale': {
      if (lastProfit === null) return strategy.base;
      if (lastProfit < 0) {
        return Math.min(prevStake * strategy.multiplier, strategy.maxStake);
      }
      return strategy.base;
    }

    case 'dalembert': {
      if (lastProfit === null) return strategy.unit;
      const base = strategy.unit;
      if (lastProfit < 0) {
        return Math.min(prevStake + strategy.unit, strategy.maxStake);
      }
      return Math.max(prevStake - strategy.unit, base);
    }
  }
}

export function useBotRunner(
  connected: boolean,
  account: DerivAccount | null,
  config: BotConfig | null,
  /** Shared WebSocket from useTradingSession — already authenticated, always live */
  sharedSocketRef: React.RefObject<WebSocket | null>,
  /** Sequence ID generator shared with the trading session — prevents req_id collisions */
  nextSharedSeqId: () => number,
  /** Session state string from useTradingSession — bot only starts when session is connected */
  sessionState: string,
): { runState: BotRunState; start: () => void; stop: () => void } {
  const currency = account?.currency ?? 'USD';
  const [runState, setRunState] = useState<BotRunState>(() =>
    makeInitialState(currency)
  );

  // Internal mutable refs (do not trigger re-renders)
  // NOTE: we do NOT own a socket — we use sharedSocketRef from useTradingSession.
  const cancelledRef = useRef(false);
  const stateRef = useRef<BotRunState>(runState);
  const configRef = useRef<BotConfig | null>(config);
  const accountRef = useRef<DerivAccount | null>(account);
  const startTimeRef = useRef<number | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightContractIdRef = useRef<string | null>(null);

  // Keep refs in sync with latest state/props
  useEffect(() => {
    stateRef.current = runState;
  }, [runState]);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  const patchState = useCallback(
    (patch: Partial<BotRunState> | ((prev: BotRunState) => Partial<BotRunState>)) => {
      setRunState((prev) => {
        const partial = typeof patch === 'function' ? patch(prev) : patch;
        const next = { ...prev, ...partial };
        stateRef.current = next;
        return next;
      });
    },
    []
  );

  const appendJournal = useCallback(
    (level: JournalEntry['level'], message: string) => {
      const entry: JournalEntry = { timestamp: Date.now(), level, message };
      patchState((prev) => ({ journal: [entry, ...prev.journal] }));
    },
    [patchState]
  );

  const setStatus = useCallback(
    (status: BotStatus, lastError: string | null = null) => {
      patchState({ status, ...(lastError !== null ? { lastError } : {}) });
    },
    [patchState]
  );

  // On mount: clear any stale pending marker left by a prior run that survived a page refresh
  useEffect(() => {
    const acc = accountRef.current;
    const cfg = configRef.current;
    if (acc && cfg) {
      const key = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
      let stale = false;
      try {
        stale = localStorage.getItem(key) !== null;
        if (stale) localStorage.removeItem(key);
      } catch {
        // ignore
      }
      if (stale) {
        const entry: JournalEntry = {
          timestamp: Date.now(),
          level: 'warn',
          message: 'Stale pending order detected on load — previous run may not have settled cleanly.',
        };
        patchState((prev) => ({ journal: [entry, ...prev.journal] }));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tear down bot loop when key dependencies change — do NOT close the shared socket
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      // Remove any dangling onmessage handler we installed
      const ws = sharedSocketRef.current;
      if (ws && (ws as unknown as { _botHandler?: unknown })._botHandler) {
        delete (ws as unknown as { _botHandler?: unknown })._botHandler;
      }
    };
  }, [connected, account?.account_id, account?.currency, config?.id, sharedSocketRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopBot = useCallback(
    (reason?: string) => {
      cancelledRef.current = true;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);

      const cfg = configRef.current;
      const acc = accountRef.current;
      const s = stateRef.current;

      // Flush pending marker
      if (acc && cfg) {
        const key = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }

      // We do not own the shared socket — do not close it.
      // Just cancel the bot loop; the trading session manages the socket lifetime.

      const finalStatus: BotStatus = reason ? 'error' : 'stopped';
      patchState({
        status: finalStatus,
        lastError: reason ?? null,
      });

      if (reason) appendJournal('error', `Bot stopped: ${reason}`);
      else appendJournal('info', 'Bot stopped.');

      // Persist run summary
      if (cfg && acc && s.startedAt !== null) {
        saveNewRun({
          botId: cfg.id,
          botName: cfg.name,
          startedAt: s.startedAt,
          endedAt: Date.now(),
          status: finalStatus,
          tradeCount: s.tradeCount,
          wins: s.wins,
          losses: s.losses,
          netPnl: s.netPnl,
          currency: s.currency,
        });
      }
    },
    [patchState, appendJournal]
  );

  const sendProposal = useCallback(
    (reqId: number, stake: number) => {
      const cfg = configRef.current;
      const acc = accountRef.current;
      const ws = sharedSocketRef.current;
      if (!cfg || !acc || cancelledRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;

      const pendingKey = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
      try { localStorage.setItem(pendingKey, 'pending'); } catch { /* ignore */ }

      appendJournal('info', `Requesting quote: ${cfg.contractType} ${cfg.symbol} stake=${stake} ${acc.currency}`);

      ws.send(JSON.stringify({
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: cfg.contractType,
        currency: acc.currency ?? 'USD',
        duration: cfg.duration,
        duration_unit: cfg.durationUnit,
        symbol: cfg.symbol,
        ...(cfg.barrier ? { barrier: cfg.barrier } : {}),
        req_id: reqId,
      }));
    },
    [appendJournal, sharedSocketRef]
  );

  const start = useCallback(() => {
    if (!connected || !account || !config) {
      appendJournal('warn', 'Cannot start: not connected or missing account/config.');
      return;
    }

    // Check that the shared session is ready — no cold start, no OTP needed
    const sessionReady = sessionState === 'Demo trading connected' || sessionState === 'Real trading connected';
    if (!sessionReady) {
      appendJournal('warn', `Trading session not ready (${sessionState}). Connect your Deriv account first.`);
      return;
    }

    const ws = sharedSocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendJournal('warn', 'Shared WebSocket is not open. Reconnect your Deriv account.');
      return;
    }

    cancelledRef.current = false;
    startTimeRef.current = Date.now();
    inFlightContractIdRef.current = null;

    const initialStake = nextStakeAmount(config.stakeStrategy, null, 0);

    setRunState({
      status: 'running',
      currentStake: initialStake,
      tradeCount: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      currency: account.currency ?? 'USD',
      transactions: [],
      journal: [{ timestamp: Date.now(), level: 'info', message: 'Bot started on existing session — no reconnect needed.' }],
      startedAt: Date.now(),
      lastError: null,
    });

    appendJournal('info', 'Sending first proposal on shared session…');

    // Track bot-owned req_ids so we only handle our own messages
    const botReqIds = new Set<number>();

    const proposalReqId = nextSharedSeqId();
    botReqIds.add(proposalReqId);

    // Install a message handler that multiplexes on req_id —
    // any message whose req_id is not in our set is passed through
    // to the previous handler (the trading session's own handler).
    const prevOnMessage = ws.onmessage;

    const botMessageHandler = (ev: MessageEvent) => {
      // Always forward to the trading session's handler first
      if (prevOnMessage) (prevOnMessage as (e: MessageEvent) => void)(ev);

      if (cancelledRef.current) return;

      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string) as Record<string, unknown>; } catch { return; }

      const msgType = msg.msg_type as string | undefined;
      const reqId = typeof msg.req_id === 'number' ? msg.req_id : null;

      // Only handle messages that belong to us
      if (reqId !== null && !botReqIds.has(reqId)) return;

      const cfg = configRef.current;
      const acc = accountRef.current;
      if (!cfg || !acc) return;

      if (msgType === 'ping' || (msg as { ping?: unknown }).ping) return;

      if (msg.error && reqId !== null && botReqIds.has(reqId)) {
        const err = msg.error as { message?: string };
        appendJournal('error', `Deriv error: ${err.message ?? JSON.stringify(msg.error)}`);
        stopBot(err.message ?? 'Deriv error');
        return;
      }

      if (msgType === 'proposal' && reqId !== null && botReqIds.has(reqId)) {
        const proposal = msg.proposal as { id?: string } | undefined;
        if (!proposal?.id) { stopBot('Invalid proposal response'); return; }
        appendJournal('info', `Quote received. Buying contract…`);
        const buyReqId = nextSharedSeqId();
        botReqIds.add(buyReqId);
        ws.send(JSON.stringify({ buy: proposal.id, price: stateRef.current.currentStake, req_id: buyReqId }));
        return;
      }

      if (msgType === 'buy' && reqId !== null && botReqIds.has(reqId)) {
        const buyResp = msg.buy as { contract_id?: number } | undefined;
        if (!buyResp?.contract_id) { stopBot('Buy response missing contract ID'); return; }
        const contractId = String(buyResp.contract_id);
        inFlightContractIdRef.current = contractId;
        appendJournal('info', `Contract ${contractId} purchased. Awaiting settlement…`);
        const monitorReqId = nextSharedSeqId();
        botReqIds.add(monitorReqId);
        ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: buyResp.contract_id, subscribe: 1, req_id: monitorReqId }));
        return;
      }

      if (msgType === 'proposal_open_contract') {
        const poc = msg.proposal_open_contract as {
          contract_id?: number; is_sold?: number | boolean; is_expired?: number | boolean;
          profit?: number; payout?: number; contract_type?: string;
          underlying?: string; date_start?: number; status?: string;
        } | undefined;
        if (!poc) return;

        // Only handle our contract
        if (poc.contract_id && String(poc.contract_id) !== inFlightContractIdRef.current) return;

        const isClosed = poc.is_sold === 1 || poc.is_sold === true || poc.is_expired === 1 || poc.is_expired === true;
        if (!isClosed) return;

        const profit = typeof poc.profit === 'number' ? poc.profit : null;
        const payout = typeof poc.payout === 'number' ? poc.payout : null;
        const stake = stateRef.current.currentStake;

        // Clear pending marker
        try { localStorage.removeItem(`tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`); } catch { /* ignore */ }
        inFlightContractIdRef.current = null;

        const tx: BotTransaction = {
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          contractId: poc.contract_id ? String(poc.contract_id) : '',
          contractType: poc.contract_type ?? cfg.contractType,
          symbol: poc.underlying ?? cfg.symbol,
          stake, payout, profit,
          currency: acc.currency ?? 'USD',
          startedAt: poc.date_start ? poc.date_start * 1000 : Date.now(),
          settledAt: Date.now(),
          status: poc.status ?? 'sold',
        };

        const isWin = poc.status === 'won' || (poc.status !== 'lost' && (profit ?? 0) > 0);
        patchState((prev) => ({
          tradeCount: prev.tradeCount + 1,
          wins: prev.wins + (isWin ? 1 : 0),
          losses: prev.losses + (isWin ? 0 : 1),
          netPnl: prev.netPnl + (profit ?? 0),
          transactions: [tx, ...prev.transactions],
        }));

        appendJournal(isWin ? 'info' : 'warn',
          `Trade ${isWin ? 'WON' : 'LOST'} — profit: ${(profit ?? 0) >= 0 ? '+' : ''}${(profit ?? 0).toFixed(2)} ${acc.currency}`);

        // Check stop conditions
        const s = stateRef.current;
        const elapsed = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0;
        let stopReason: string | null = null;

        for (const cond of cfg.stopConditions) {
          if (cond.type === 'profit' && s.netPnl >= cond.target) { stopReason = `Profit target reached (+${s.netPnl.toFixed(2)})`; break; }
          if (cond.type === 'loss' && s.netPnl <= -Math.abs(cond.limit)) { stopReason = `Loss limit reached (${s.netPnl.toFixed(2)})`; break; }
          if (cond.type === 'tradeCount' && s.tradeCount >= cond.max) { stopReason = `Max trades reached (${s.tradeCount})`; break; }
          if (cond.type === 'time' && elapsed >= cond.seconds) { stopReason = `Time limit reached (${Math.round(elapsed)}s)`; break; }
        }
        if (!stopReason && cfg.maxTradesPerDay > 0 && s.tradeCount >= cfg.maxTradesPerDay) {
          stopReason = `Daily trade cap reached (${s.tradeCount})`;
        }
        if (!stopReason && !isWin) {
          let consec = 0;
          for (const t of s.transactions) { if ((t.profit ?? 0) < 0) consec++; else break; }
          if (consec >= cfg.maxConsecutiveLosses) stopReason = `Max consecutive losses (${consec})`;
        }

        if (stopReason) {
          appendJournal('info', stopReason);
          // Restore previous handler before stopping
          if (ws.onmessage === botMessageHandler) ws.onmessage = prevOnMessage;
          stopBot();
          return;
        }

        // Schedule next trade after cooldown
        const nextStake = nextStakeAmount(cfg.stakeStrategy, profit, stake);
        patchState({ currentStake: nextStake, status: 'cooldown' });
        appendJournal('info', `Cooldown ${cfg.cooldownSeconds}s…`);

        cooldownTimerRef.current = setTimeout(() => {
          if (cancelledRef.current) return;
          patchState({ status: 'running' });
          const nextReqId = nextSharedSeqId();
          botReqIds.add(nextReqId);
          sendProposal(nextReqId, nextStake);
        }, cfg.cooldownSeconds * 1000);
      }
    };

    ws.onmessage = botMessageHandler;
    sendProposal(proposalReqId, initialStake);

  }, [connected, account, config, sessionState, sharedSocketRef, nextSharedSeqId, appendJournal, sendProposal, stopBot, patchState]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    setStatus('stopping');
    appendJournal('info', 'Stop requested…');
    cancelledRef.current = true;
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    stopBot();
  }, [setStatus, appendJournal, stopBot]);

  return { runState, start, stop };
}
