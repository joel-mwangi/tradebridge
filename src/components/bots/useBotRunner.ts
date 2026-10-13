'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  config: BotConfig | null
): { runState: BotRunState; start: () => void; stop: () => void } {
  const currency = account?.currency ?? 'USD';
  const [runState, setRunState] = useState<BotRunState>(() =>
    makeInitialState(currency)
  );

  // Internal mutable refs (do not trigger re-renders)
  const socketRef = useRef<WebSocket | null>(null);
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

  // Tear down socket when key dependencies change
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connected, account?.account_id, account?.currency, config?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

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
    (ws: WebSocket, stake: number) => {
      const cfg = configRef.current;
      const acc = accountRef.current;
      if (!cfg || !acc || cancelledRef.current) return;

      const pendingKey = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
      try {
        localStorage.setItem(pendingKey, 'pending');
      } catch {
        // ignore
      }

      appendJournal('info', `Sending proposal: ${cfg.contractType} ${cfg.symbol} stake=${stake} ${acc.currency}`);

      ws.send(
        JSON.stringify({
          proposal: 1,
          amount: stake,
          basis: 'stake',
          contract_type: cfg.contractType,
          currency: acc.currency ?? 'USD',
          duration: cfg.duration,
          duration_unit: cfg.durationUnit,
          symbol: cfg.symbol,
          ...(cfg.barrier ? { barrier: cfg.barrier } : {}),
        })
      );
    },
    [appendJournal]
  );

  const start = useCallback(() => {
    if (!connected || !account || !config) {
      appendJournal('warn', 'Cannot start: not connected or missing account/config.');
      return;
    }

    cancelledRef.current = false;
    startTimeRef.current = Date.now();
    inFlightContractIdRef.current = null;

    const initialStake = nextStakeAmount(config.stakeStrategy, null, 0);

    // Reset state
    setRunState({
      status: 'connecting',
      currentStake: initialStake,
      tradeCount: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      currency: account.currency ?? 'USD',
      transactions: [],
      journal: [{ timestamp: Date.now(), level: 'info', message: 'Starting bot...' }],
      startedAt: Date.now(),
      lastError: null,
    });

    // POST to /api/auth/deriv/trade-session to get an authenticated OTP WebSocket URL.
    // This is the same pattern used by useDemoTrading.ts — the URL already embeds
    // the one-time password so no separate authorize message is needed.
    fetch('/api/auth/deriv/trade-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: account.account_id }),
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data: { url?: string; error?: string }) => {
        if (cancelledRef.current) return;
        if (!data.url) {
          stopBot(data.error ?? 'Failed to obtain trade session URL.');
          return;
        }

        const ws = new WebSocket(data.url);
        socketRef.current = ws;

        ws.onopen = () => {
          if (cancelledRef.current) { ws.close(); return; }
          // The OTP URL authenticates the connection — no authorize message needed.
          setStatus('running');
          appendJournal('info', 'Authenticated session connected. Sending first proposal…');
          const stake = stateRef.current.currentStake;
          sendProposal(ws, stake);
        };

        ws.onmessage = (ev) => {
          if (cancelledRef.current) return;

          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(ev.data as string) as Record<string, unknown>;
          } catch {
            return;
          }

          const cfg = configRef.current;
          const acc = accountRef.current;
          if (!cfg || !acc) return;

          const msgType = msg.msg_type as string | undefined;

          // Ping/pong — ignore
          if (msgType === 'ping' || (msg as { ping?: unknown }).ping) return;

          if (msgType === 'proposal') {
            const proposal = msg.proposal as { id?: string } | undefined;
            if (!proposal?.id) return;
            appendJournal('info', `Got proposal ${proposal.id}. Buying…`);
            ws.send(JSON.stringify({ buy: proposal.id, price: stateRef.current.currentStake }));
            return;
          }

          if (msgType === 'buy') {
            const buyResp = msg.buy as { contract_id?: number } | undefined;
            if (buyResp?.contract_id) {
              inFlightContractIdRef.current = String(buyResp.contract_id);
              appendJournal('info', `Contract bought: ${buyResp.contract_id}`);
              ws.send(
                JSON.stringify({
                  proposal_open_contract: 1,
                  contract_id: buyResp.contract_id,
                  subscribe: 1,
                })
              );
            }
            return;
          }

          if (msgType === 'proposal_open_contract') {
            const poc = msg.proposal_open_contract as {
              contract_id?: number;
              is_sold?: number | boolean;
              is_expired?: number | boolean;
              profit?: number;
              buy_price?: number;
              payout?: number;
              contract_type?: string;
              underlying?: string;
              date_start?: number;
              date_expiry?: number;
              status?: string;
            } | undefined;
            if (!poc) return;

            const isSold =
              poc.is_sold === 1 || poc.is_sold === true;
            const isExpired =
              poc.is_expired === 1 || poc.is_expired === true;

            if (!isSold && !isExpired) return; // Still in-flight

            const profit = typeof poc.profit === 'number' ? poc.profit : null;
            const payout = typeof poc.payout === 'number' ? poc.payout : null;
            const stake = stateRef.current.currentStake;

            const tx: BotTransaction = {
              id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              contractId: poc.contract_id ? String(poc.contract_id) : '',
              contractType: poc.contract_type ?? cfg.contractType,
              symbol: poc.underlying ?? cfg.symbol,
              stake,
              payout,
              profit,
              currency: acc.currency ?? 'USD',
              startedAt: poc.date_start ? poc.date_start * 1000 : Date.now(),
              settledAt: Date.now(),
              status: poc.status ?? 'sold',
            };

            // Clear pending marker
            const pendingKey = `tradebridge:bot-order-pending:${acc.account_id}:${cfg.id}`;
            try { localStorage.removeItem(pendingKey); } catch { /* ignore */ }

            inFlightContractIdRef.current = null;

            // Update counts
            const isWin = (profit ?? 0) > 0;
            patchState((prev) => ({
              tradeCount: prev.tradeCount + 1,
              wins: prev.wins + (isWin ? 1 : 0),
              losses: prev.losses + (isWin ? 0 : 1),
              netPnl: prev.netPnl + (profit ?? 0),
              transactions: [tx, ...prev.transactions],
            }));

            appendJournal(
              isWin ? 'info' : 'warn',
              `Trade settled: ${isWin ? 'WIN' : 'LOSS'} profit=${profit ?? 0} ${acc.currency}`
            );

            // Check stop conditions
            const s = stateRef.current;
            const elapsed = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0;
            let stopReason: string | null = null;

            for (const cond of cfg.stopConditions) {
              if (cond.type === 'profit' && s.netPnl >= cond.target) {
                stopReason = `Profit target reached (${s.netPnl.toFixed(2)} >= ${cond.target})`;
                break;
              }
              if (cond.type === 'loss' && s.netPnl <= -Math.abs(cond.limit)) {
                stopReason = `Loss limit reached (${s.netPnl.toFixed(2)} <= -${cond.limit})`;
                break;
              }
              if (cond.type === 'tradeCount' && s.tradeCount >= cond.max) {
                stopReason = `Max trade count reached (${s.tradeCount})`;
                break;
              }
              if (cond.type === 'time' && elapsed >= cond.seconds) {
                stopReason = `Time limit reached (${Math.round(elapsed)}s)`;
                break;
              }
            }

            // Enforce maxTradesPerDay cap
            if (!stopReason && cfg.maxTradesPerDay > 0 && s.tradeCount >= cfg.maxTradesPerDay) {
              stopReason = `Daily trade limit reached (${s.tradeCount}/${cfg.maxTradesPerDay})`;
            }

            if (stopReason) {
              appendJournal('info', stopReason);
              stopBot();
              return;
            }

            // Max consecutive losses guard
            if (!isWin && s.losses > 0) {
              // Count consecutive losses from transactions
              let consec = 0;
              for (const t of s.transactions) {
                if ((t.profit ?? 0) < 0) consec++;
                else break;
              }
              if (consec >= cfg.maxConsecutiveLosses) {
                appendJournal('warn', `Max consecutive losses (${consec}) reached.`);
                stopBot();
                return;
              }
            }

            // Compute next stake
            const nextStake = nextStakeAmount(cfg.stakeStrategy, profit, stake);
            patchState({ currentStake: nextStake, status: 'cooldown' });
            appendJournal('info', `Cooling down ${cfg.cooldownSeconds}s…`);

            cooldownTimerRef.current = setTimeout(() => {
              if (cancelledRef.current) return;
              patchState({ status: 'running' });
              sendProposal(ws, nextStake);
            }, cfg.cooldownSeconds * 1000);

            return;
          }

          if (msg.error) {
            const err = msg.error as { message?: string };
            appendJournal('error', `WS error: ${err.message ?? JSON.stringify(msg.error)}`);
            stopBot(err.message ?? 'WebSocket error');
          }
        };

        ws.onerror = () => {
          if (!cancelledRef.current) stopBot('WebSocket connection error');
        };

        ws.onclose = () => {
          if (!cancelledRef.current) {
            const s = stateRef.current;
            if (s.status === 'running' || s.status === 'cooldown' || s.status === 'connecting') {
              stopBot('WebSocket closed unexpectedly');
            }
          }
        };
      })
      .catch((err: unknown) => {
        if (!cancelledRef.current) {
          stopBot(`Failed to fetch trade session: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
  }, [connected, account, config, appendJournal, setStatus, sendProposal, stopBot, patchState]);

  const stop = useCallback(() => {
    setStatus('stopping');
    appendJournal('info', 'Stop requested…');
    stopBot();
  }, [setStatus, appendJournal, stopBot]);

  return { runState, start, stop };
}
