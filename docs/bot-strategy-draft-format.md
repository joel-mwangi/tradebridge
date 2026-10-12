# TradeBridge strategy draft format (version 1)

TradeBridge's Bot Builder currently stores strategies as **drafts only**. Saving or importing a file does not arm a bot or place orders.

## Native JSON schema

Use a JSON object with these fields:

```json
{
  "version": 1,
  "market": "1HZ75V",
  "contract_type": "DIGITOVER",
  "barrier": 5,
  "duration_ticks": 1,
  "stake": 1,
  "entry_rule": "manual_review",
  "frequency_window": 100,
  "max_session_loss": 5,
  "session_profit_target": 5
}
```

Supported `contract_type` values:

- `DIGITOVER` and `DIGITUNDER`: `barrier` must be an integer from 0 to 9.
- `DIGITMATCH` and `DIGITDIFF`: `barrier` is the target digit (0–9).
- `DIGITEVEN` and `DIGITODD`: `barrier` must be `null`.

Other constraints:

- `market`: 2–32 alphanumeric/underscore characters.
- `duration_ticks`: integer from 1 to 10,000.
- `stake`: positive number, maximum 10,000 (account currency).
- `entry_rule`: `manual_review` or `last_digit_frequency`.
- `frequency_window`: integer from 10 to 5,000 ticks.
- `max_session_loss` and `session_profit_target`: non-negative account-currency amounts.

Example with no barrier:

```json
{
  "version": 1,
  "market": "1HZ75V",
  "contract_type": "DIGITEVEN",
  "barrier": null,
  "duration_ticks": 1,
  "stake": 1,
  "entry_rule": "manual_review",
  "frequency_window": 100,
  "max_session_loss": 5,
  "session_profit_target": 5
}
```

## Deriv Bot XML

The importer parses Blockly XML and reports recognized or unsupported block types. This is an inspection step, **not a complete XML-to-strategy compiler**. Unsupported blocks remain non-executable drafts; recognized blocks do not guarantee that the strategy's semantics are understood.

## Execution and safety boundary

The current runner executes its existing candle-based strategy types. It does not yet interpret records in `bot_strategy_definitions` as digit-contract orders. Strategy records are therefore saved with status `draft`; the UI must not report them as `READY` or `RUNNING`.

Before enabling execution, implement and test a server-side interpreter that maps each supported contract to a valid Deriv proposal, verifies account type and risk limits, prevents duplicate buys, records contract IDs, reconciles settlement, and stops new entries when session limits are reached. Apply the migration `supabase/migrations/20261012120000_add_bot_strategy_definitions.sql` before using saved drafts.
