# TradeBridge

A web-based trading platform foundation intended to connect to the Deriv API. This repository is being initialized; live account authorization and order execution are not yet implemented.

## Stack
- Next.js App Router
- React and TypeScript
- Responsive custom CSS

## Requirements
- Node.js 20.9+ (Node.js 22 LTS recommended)
- npm

## Local development
```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment
Copy `.env.example` to `.env.local` and fill in the public app ID when available. Never commit secrets or access tokens. Do not expose private credentials in `NEXT_PUBLIC_*` variables.

## Current status
- [x] Repository README and initial project structure
- [ ] Responsive trading dashboard
- [ ] Deriv account authorization and secure session handling
- [ ] Live market data and proposal quotes
- [ ] Explicitly confirmed trade execution
- [ ] Transaction history, errors, and tests

## Safety
- Sample prices and balances must be clearly labelled and must never be presented as live.
- Test with a Deriv demo account before considering real-money workflows.
- Verify Deriv API and partnership/markup terms before charging users or enabling a markup.
- Do not execute orders without a fresh quote, server-side validation, and explicit user confirmation.
