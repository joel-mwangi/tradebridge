# TradeBridge strategy source of truth

The digit strategy is governed by this specification, not by older strategy notes.

- The user selects Over or Under, selects a barrier digit, and clicks Run.
- Use the user-selected observed-tick frequency window (50/100/250/500/1,000).
- Red and Green identities must remain unchanged continuously for 15 seconds. Any change cancels the setup and restarts a full 15-second timer.
- Rank colours from all ten digit frequencies: Green most frequent, Blue second most frequent, Red least frequent, Yellow second least frequent. Preserve ties; exactly one Red is required.
- Qualification is not an entry signal. Require all applicable percentages, colour positions, Red-count, 0.1 percentage-point trigger, and post-trigger tick-sequence rules to pass before buying.
- Over 3: digits 0–3; at least three percentages <9.7%, remaining one <10.5% (or all four <9.7%); Red/Yellow digits 0–4 and each <9%; Green/Blue digits 5–9; least or second-least digit among 0–3 rises by 0.1 percentage point; then one or more digits 0–3 followed by a digit 6–9.
- Under 6: digits 6–9; at least three percentages <9.7%; Red/Yellow digits 5–9; Green/Blue digits 0–4; least digit among 6–9 rises by 0.1 percentage point; then one or more digits 6–9 followed by a digit 0–3.
- A completed sequence permits one sequence of up to three sequential buys. Wait for settlement and reconciliation after every buy. Stop immediately after two consecutive losses; never place the third buy after two consecutive losses. A win or breakeven resets the consecutive-loss count.
- After three buys or the two-loss stop, stop the strategy. Require the user to click Run again; no automatic restart.
- Unknown order outcomes require reconciliation and must not be retried automatically. Real-account auto-execution remains disabled.
- For unspecified barrier-specific rules, fail closed rather than inventing thresholds or ranges.

Tests must verify these requirements, especially that automatic execution listens for a completed entry signal—not merely a qualified market.
