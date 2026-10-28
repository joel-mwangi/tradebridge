# TradeBridge MT5 market-selection EA

This Expert Advisor connects an MT5 terminal to the TradeBridge backend and handles **market selection only**. It does not place, modify, or close trades.

## Install

1. Open MetaTrader 5 and select **File → Open Data Folder**.
2. Open the MQL5/Experts folder and copy TradeBridgeMarketBridge.mq5 there.
3. Open the file in MetaEditor and compile it.
4. In MT5, open **Tools → Options → Expert Advisors** and add the backend base URL to the allowed WebRequest URLs: https://ai-tradingbridge.vercel.app
5. Attach the EA to a chart. Algo Trading must be enabled for the EA to run, but this EA contains no order-placement functions.

## Configure inputs

- InpBackendBaseUrl: deployed TradeBridge backend URL.
- InpDeviceCredential: the raw device credential returned once by the authenticated POST /mt5/pair flow. Keep it private; never commit it to Git.
- InpSymbolMappings: explicit provider-to-broker mappings separated by semicolons. Example: frxEURUSD=EURUSD;frxGBPUSD=GBPUSD. Add only symbols that actually exist on the connected broker.
- InpPollSeconds: polling interval (1–60 seconds; default 3).
- InpHttpTimeoutMs: HTTP request timeout.

The EA deliberately does not assume a provider symbol is the same as the broker symbol. If no explicit mapping exists, it rejects the command with SYMBOL_MAPPING_MISSING.

## Command lifecycle

1. Polls GET /mt5/ea/commands/next?lease_seconds=20 using the paired device credential.
2. Resolves the provider symbol through the configured mapping.
3. Selects the mapped broker symbol in Market Watch using SymbolSelect(symbol, true).
4. Acknowledges the command with the exact lease_token returned by the backend.
5. Reports selection or rejection in the acknowledgement result.

If an acknowledgement request fails, the lease will eventually expire and the backend may lease the command again. Selection is idempotent, so retrying a market selection is safe.

## Operational notes

- Use only with the backend deployment that contains the /mt5/ea/commands/next and /mt5/ea/commands/{command_id}/ack endpoints.
- The EA uses MT5's synchronous WebRequest; network requests run on the timer event, not on every tick.
- The backend credential is stored in EA inputs / terminal configuration. Protect the terminal profile and do not share configuration exports containing the credential.
- This source has not been compiled in MetaEditor or verified against a live broker terminal in this change. Compile and validate it on a demo terminal before operational use.
- No order execution, lot sizing, stop loss, take profit, or trading permissions are implemented.
