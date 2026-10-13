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
): { runState: BotRunState; start: () => void; stop: () => void; orderRecoveryRequired: boolean; acknowledgeOrderReconciled: () => void } {
  const currency = account?.currency ?? 'USD';
  const [runState, setRunState] = useState<BotRunState>(() =>
    makeInitialState(currency)
  );
  const [orderRecoveryRequired, setOrderRecoveryRequired] = useState(false);

  // Internal mutable refs (do not trigger re-renders)
  // NOTE: we do NOT own a socket — we use sharedSocketRef from useTradingSession.
  const cancelledRef = useRef(false);
  const stateRef = useRef<BotRunState>(runState);
  const configRef = useRef<BotConfig | null>(config);
  const accountRef = useRef<DerivAccount | null>(account);
  const sessionStateRef = useRef(sessionState);
  const startTimeRef = useRef<number | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightContractIdRef = useRef<string | null>(null);
  const activeRequestRef = useRef<number | null>(null);
  const handlerRef = useRef<EventListener | null>(null);
  const contractStatusSeenRef = useRef(false);
  const orderOutcomeUnknownRef = useRef(false);

  // Keep refs in sync with latest state/props
  useEffect(() => { stateRef.current = runState; }, [runState]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { accountRef.current = account; }, [account]);
  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);

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

  useEffect(() => {
    const acc = accountRef.current;
    const cfg = configRef.current;
    if (!acc || !cfg) {
      setOrderRecoveryRequired(false);
      return;
    }
    try {
      setOrderRecoveryRequired(localStorage.getItem(`tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`) !== null);
    } catch {
      setOrderRecoveryRequired(true);
    }
  }, [account?.account_id, config?.id]);

  // On mount, preserve unresolved order markers. Clearing one on page load can
  // allow a duplicate purchase if Deriv accepted the prior order but the browser
  // lost its acknowledgement.
  useEffect(() => {
    const acc = accountRef.current;
    const cfg = configRef.current;
    if (!acc || !cfg) return;
    const key = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
    try {
      if (localStorage.getItem(key) !== null) {
        const entry: JournalEntry = {
          timestamp: Date.now(),
          level: 'warn',
          message: 'Unresolved order marker found. Check Deriv open contracts and account history before restarting this bot.',
        };
        patchState((prev) => ({ journal: [entry, ...prev.journal] }));
      }
    } catch {
      const entry: JournalEntry = {
        timestamp: Date.now(),
        level: 'error',
        message: 'Browser storage is unavailable; order recovery cannot be verified safely.',
      };
      patchState((prev) => ({ journal: [entry, ...prev.journal] }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tear down bot loop when key dependencies change — do NOT close the shared socket
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
      // Bot handlers are registered as independent listeners; never replace the
      // shared trading session's onmessage callback.
      const ws = sharedSocketRef.current;
      const handler = handlerRef.current;
      if (ws && handler) ws.removeEventListener('message', handler);
      handlerRef.current = null;
      if (ws) delete (ws as WebSocket & { __tradeBridgeBotHandler?: EventListener }).__tradeBridgeBotHandler;
    };
  }, [connected, account?.account_id, account?.currency, config?.id, sharedSocketRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopBot = useCallback(
    (reason?: string) => {
      cancelledRef.current = true;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);

      const cfg = configRef.current;
      const acc = accountRef.current;
      const s = stateRef.current;

      // Do not clear an unresolved order marker after a purchase may have been
      // accepted. A timeout/disconnect can lose the acknowledgement while Deriv
      // still owns an open contract; require reconciliation before another order.
      if (acc && cfg && !orderOutcomeUnknownRef.current && !inFlightContractIdRef.current) {
        const key = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
        try { localStorage.removeItem(key); setOrderRecoveryRequired(false); } catch { /* storage is best-effort */ }
      }
      if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
      const currentSocket = sharedSocketRef.current;
      if (currentSocket && handlerRef.current) currentSocket.removeEventListener('message', handlerRef.current);
      handlerRef.current = null;
      if (currentSocket) delete (currentSocket as WebSocket & { __tradeBridgeBotHandler?: EventListener }).__tradeBridgeBotHandler;

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
    [patchState, appendJournal, sharedSocketRef]
  );

  const sendProposal = useCallback(
    (reqId: number, stake: number) => {
      const cfg = configRef.current;
      const acc = accountRef.current;
      const ws = sharedSocketRef.current;
      if (!cfg || !acc || cancelledRef.current || !ws || ws.readyState !== WebSocket.OPEN) {
        stopBot('Cannot send proposal: bot configuration, account, or authenticated WebSocket is unavailable.');
        return;
      }

      appendJournal('info', `Requesting quote: ${cfg.contractType} ${cfg.symbol} stake=${stake} ${acc.currency}`);

      activeRequestRef.current = reqId;
      if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
      responseTimerRef.current = setTimeout(() => {
        if (activeRequestRef.current !== reqId || cancelledRef.current) return;
        orderOutcomeUnknownRef.current = false;
        stopBot('Timed out waiting for Deriv proposal response. No purchase was confirmed; reconnect and retry after checking the session.');
      }, 15000);
      try { ws.send(JSON.stringify({
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
      })); } catch {
        if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
        responseTimerRef.current = null;
        stopBot('Could not send proposal on the Deriv WebSocket.');
      }
    },
    [appendJournal, sharedSocketRef, stopBot]
  );

  const start = useCallback(() => {
    if (!connected || !account || !config) {
      appendJournal('warn', 'Cannot start: not connected or missing account/config.');
      return;
    }

    // Check that the shared session is ready — read from ref, never stale
    const sessionReady = sessionStateRef.current === 'Demo trading connected';
    if (!sessionReady) {
      appendJournal('warn', `Trading session not ready (${sessionStateRef.current}). Connect your Deriv account on the Trade page first.`);
      stopBot(`Session not ready: ${sessionStateRef.current}`);
      return;
    }

    const ws = sharedSocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendJournal('warn', 'Shared WebSocket is not open. Reconnect your Deriv account.');
      return;
    }

    // This client-side runner is intentionally demo-only. Real-account orders
    // must never be reachable through a stale UI/session state.
    if ((account.account_type ?? '').toLowerCase() !== 'demo') {
      appendJournal('error', 'Demo-only bot blocked: select a verified Demo account.');
      return;
    }
    const pendingKey = `tradebridge:bot-order-pending:${account.account_id}:${config.id}`;
    try {
      if (localStorage.getItem(pendingKey) !== null) {
        appendJournal('error', 'An unresolved order marker exists for this bot. Reconcile open contracts and account history in Deriv before restarting.');
        return;
      }
    } catch {
      appendJournal('error', 'Browser storage is unavailable; cannot safely confirm there is no unresolved order.');
      return;
    }
    if (stateRef.current.status === 'running' || stateRef.current.status === 'cooldown' || stateRef.current.status === 'connecting') {
      appendJournal('warn', 'This bot is already active. Stop it before starting another run.');
      return;
    }
    cancelledRef.current = false;
    orderOutcomeUnknownRef.current = false;
    startTimeRef.current = Date.now();
    inFlightContractIdRef.current = null;

    const initialStake = nextStakeAmount(config.stakeStrategy, null, 0);

    const initialState: BotRunState = {
      status: 'running',
      currentStake: initialStake,
      tradeCount: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      currency: account.currency ?? 'USD',
      transactions: [],
      journal: [
        { timestamp: Date.now(), level: 'info', message: 'Bot started on existing session — no reconnect needed.' },
        { timestamp: Date.now(), level: 'info', message: 'Sending first proposal on shared session…' },
      ],
      startedAt: Date.now(),
      lastError: null,
    };
    stateRef.current = initialState;
    setRunState(initialState);

    // Track bot-owned req_ids so we only handle our own messages
    const botReqIds = new Set<number>();
    const requestStage = new Map<number, 'proposal' | 'buy' | 'monitor'>();

    const proposalReqId = nextSharedSeqId();
    botReqIds.add(proposalReqId);
    requestStage.set(proposalReqId, 'proposal');

    // Observe the shared socket without taking ownership of its onmessage
    // callback. Only exact req_id matches and the exact open contract are ours.
    const botMessageHandler = (event: Event) => {
      const ev = event as MessageEvent;

      if (cancelledRef.current) return;

      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string) as Record<string, unknown>; } catch { return; }

      const msgType = msg.msg_type as string | undefined;
      const reqId = typeof msg.req_id === 'number' ? msg.req_id : null;

      const cfg = configRef.current;
      const acc = accountRef.current;
      if (!cfg || !acc) return;

      if (msgType === 'ping' || (msg as { ping?: unknown }).ping) return;

      // Error on one of our requests
      if (msg.error && reqId !== null && botReqIds.has(reqId)) {
        if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
        responseTimerRef.current = null;
        activeRequestRef.current = null;
        const err = msg.error as { message?: string };
        const stage = requestStage.get(reqId);
        // A rejected buy is an explicit broker response, so it is safe to clear
        // the marker. A lost acknowledgement is not and is handled by timeout.
        if (stage === 'buy') {
          try { localStorage.removeItem(`tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`); setOrderRecoveryRequired(false); } catch { /* ignore */ }
        }
        appendJournal('error', `Deriv error (${stage ?? 'request'}): ${err.message ?? JSON.stringify(msg.error)}`);
        stopBot(err.message ?? 'Deriv error');
        return;
      }

      // Never infer ownership from msg_type alone: a missing req_id is not ours.
      if (msgType === 'proposal') {
        if (reqId === null || !botReqIds.has(reqId) || requestStage.get(reqId) !== 'proposal') return;
        if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
        responseTimerRef.current = null;
        activeRequestRef.current = null;
        const proposal = msg.proposal as { id?: string } | undefined;
        if (!proposal?.id) { stopBot('Invalid proposal response'); return; }
        appendJournal('info', `Quote received (id=${proposal.id}). Buying…`);
        try {
          localStorage.setItem(`tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`, 'pending');
          setOrderRecoveryRequired(true);
        } catch {
          orderOutcomeUnknownRef.current = true;
          stopBot('Cannot persist the order safety marker. Trading stopped before purchase; verify the Deriv account before retrying.');
          return;
        }
        const buyReqId = nextSharedSeqId();
        botReqIds.add(buyReqId);
        requestStage.set(buyReqId, 'buy');
        activeRequestRef.current = buyReqId;
        try {
          ws.send(JSON.stringify({ buy: proposal.id, price: stateRef.current.currentStake, req_id: buyReqId }));
          if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
          responseTimerRef.current = setTimeout(() => {
            if (activeRequestRef.current !== buyReqId || cancelledRef.current) return;
            orderOutcomeUnknownRef.current = true;
            stopBot('Timed out waiting for Deriv purchase acknowledgement. The order outcome is unknown; reconcile the Deriv account before restarting.');
          }, 15000);
        } catch {
          orderOutcomeUnknownRef.current = true;
          stopBot('Purchase request could not be sent reliably. Reconcile the Deriv account before restarting.');
        }
        return;
      }

      // Buy response: require the exact request id and buy stage.
      if (msgType === 'buy') {
        if (reqId === null || !botReqIds.has(reqId) || requestStage.get(reqId) !== 'buy') return;
        if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
        responseTimerRef.current = null;
        activeRequestRef.current = null;
        const buyResp = msg.buy as { contract_id?: number | string } | undefined;
        if (buyResp?.contract_id === undefined || buyResp?.contract_id === null || String(buyResp.contract_id) === '') {
          orderOutcomeUnknownRef.current = true;
          stopBot('Buy response missing contract ID. Reconcile the Deriv account before restarting.');
          return;
        }
        const contractId = String(buyResp.contract_id);
        inFlightContractIdRef.current = contractId;
        contractStatusSeenRef.current = false;
        appendJournal('info', `Contract ${contractId} purchased. Awaiting settlement…`);
        const monitorReqId = nextSharedSeqId();
        botReqIds.add(monitorReqId);
        requestStage.set(monitorReqId, 'monitor');
        activeRequestRef.current = monitorReqId;
        try {
          ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: buyResp.contract_id, subscribe: 1, req_id: monitorReqId }));
          responseTimerRef.current = setTimeout(() => {
            if (activeRequestRef.current !== monitorReqId || cancelledRef.current || !inFlightContractIdRef.current) return;
            orderOutcomeUnknownRef.current = true;
            stopBot('Timed out waiting for contract status. The contract may still be open; reconcile it in Deriv before restarting.');
          }, 30000);
        } catch {
          orderOutcomeUnknownRef.current = true;
          stopBot('Could not subscribe to contract status. The contract may still be open; reconcile it in Deriv before restarting.');
        }
        return;
      }

      // Settlement — subscription pushes have no req_id; filter by contract_id instead
      if (msgType === 'proposal_open_contract') {
        const poc = msg.proposal_open_contract as {
          contract_id?: number; is_sold?: number | boolean; is_expired?: number | boolean;
          profit?: number; payout?: number; contract_type?: string;
          underlying?: string; date_start?: number; status?: string;
        } | undefined;
        if (!poc) return;

        // Only handle our in-flight contract
        if (!inFlightContractIdRef.current || poc.contract_id === undefined || poc.contract_id === null) return;
        if (String(poc.contract_id) !== inFlightContractIdRef.current) return;
        // The first matching status message proves the subscription is alive.
        // Do not use the short subscription-ack timeout as a settlement timeout.
        if (!contractStatusSeenRef.current) {
          contractStatusSeenRef.current = true;
          if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
          responseTimerRef.current = setTimeout(() => {
            if (!inFlightContractIdRef.current || cancelledRef.current) return;
            orderOutcomeUnknownRef.current = true;
            stopBot('Contract status stopped updating before settlement. Reconcile the open contract and account history in Deriv before restarting.');
          }, Math.max(60000, cfg.durationUnit === 's' ? (cfg.duration + 60) * 1000 : 120000));
        }

        const isClosed = poc.is_sold === 1 || poc.is_sold === true
          || poc.is_expired === 1 || poc.is_expired === true
          || poc.status === 'won' || poc.status === 'lost'
          || poc.status === 'sold' || poc.status === 'expired';
        if (!isClosed) return;

        const profit = typeof poc.profit === 'number' ? poc.profit : Number.isFinite(Number(poc.profit)) ? Number(poc.profit) : null;
        const payout = typeof poc.payout === 'number' ? poc.payout : Number.isFinite(Number(poc.payout)) ? Number(poc.payout) : null;
        if (profit === null) {
          orderOutcomeUnknownRef.current = true;
          stopBot('Deriv closed the contract without a usable realized profit value. Reconcile account history before restarting.');
          return;
        }
        if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
        responseTimerRef.current = null;
        activeRequestRef.current = null;
        const stake = stateRef.current.currentStake;

        try { localStorage.removeItem(`tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`); setOrderRecoveryRequired(false); } catch { /* ignore */ }
        orderOutcomeUnknownRef.current = false;
        inFlightContractIdRef.current = null;
        contractStatusSeenRef.current = false;

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
        const prior = stateRef.current;
        const nextTransactions = [tx, ...prior.transactions];
        const nextRunState: BotRunState = {
          ...prior,
          tradeCount: prior.tradeCount + 1,
          wins: prior.wins + (isWin ? 1 : 0),
          losses: prior.losses + (isWin ? 0 : 1),
          netPnl: prior.netPnl + profit,
          transactions: nextTransactions,
        };
        // Update the authoritative ref synchronously before evaluating stop gates.
        stateRef.current = nextRunState;
        patchState(nextRunState);

        appendJournal(isWin ? 'info' : 'warn',
          `Trade ${isWin ? 'WON' : 'LOST'} — profit: ${(profit ?? 0) >= 0 ? '+' : ''}${(profit ?? 0).toFixed(2)} ${acc.currency}`);

        // Check stop conditions
        const s = nextRunState;
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
          stopBot();
          return;
        }

        // Schedule next trade after cooldown
        const nextStake = nextStakeAmount(cfg.stakeStrategy, profit, stake);
        patchState({ currentStake: nextStake, status: 'cooldown' });
        appendJournal('info', `Cooldown ${cfg.cooldownSeconds}s…`);

        cooldownTimerRef.current = setTimeout(() => {
          if (cancelledRef.current) {
            return;
          }
          patchState({ status: 'running' });
          const nextReqId = nextSharedSeqId();
          botReqIds.add(nextReqId);
          requestStage.set(nextReqId, 'proposal');
          sendProposal(nextReqId, nextStake);
        }, cfg.cooldownSeconds * 1000);
      }
    };

    const eventHandler = botMessageHandler as EventListener;
    handlerRef.current = eventHandler;
    ws.addEventListener('message', eventHandler);
    (ws as WebSocket & { __tradeBridgeBotHandler?: EventListener }).__tradeBridgeBotHandler = eventHandler;
    sendProposal(proposalReqId, initialStake);

  }, [connected, account, config, sharedSocketRef, nextSharedSeqId, appendJournal, sendProposal, stopBot, patchState]); // eslint-disable-line react-hooks/exhaustive-deps

  const acknowledgeOrderReconciled = useCallback(() => {
    const acc = accountRef.current;
    const cfg = configRef.current;
    if (!acc || !cfg || typeof window === 'undefined') return;
    const confirmed = window.confirm(
      'Only continue if you checked Deriv directly and confirmed there is no unresolved/open contract from this bot. Clear the recovery lock?'
    );
    if (!confirmed) return;
    try {
      localStorage.removeItem(`tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`);
      orderOutcomeUnknownRef.current = false;
      inFlightContractIdRef.current = null;
      contractStatusSeenRef.current = false;
      setOrderRecoveryRequired(false);
      appendJournal('warn', 'Recovery lock cleared after manual Deriv reconciliation.');
    } catch {
      appendJournal('error', 'Could not clear recovery lock because browser storage is unavailable.');
    }
  }, [appendJournal]);

  const stop = useCallback(() => {
    setStatus('stopping');
    appendJournal('info', 'Stop requested…');
    cancelledRef.current = true;
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    stopBot();
  }, [setStatus, appendJournal, stopBot]);

  return { runState, start, stop, orderRecoveryRequired, acknowledgeOrderReconciled };
}
