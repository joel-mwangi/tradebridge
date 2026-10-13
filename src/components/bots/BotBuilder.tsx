'use client';

import dynamic from 'next/dynamic';
import type { BotConfig } from './bot-types';

export interface BotBuilderProps {
  onSaveConfig: (config: BotConfig) => void;
}

const BotBuilderInner = dynamic(
  () => import('./BotBuilderInner').then((mod) => mod.BotBuilderInner),
  {
    ssr: false,
    loading: () => (
      <div style={{ padding: '32px', color: 'var(--muted)', fontSize: '12px' }}>
        Loading bot builder…
      </div>
    ),
  }
);

export function BotBuilder(props: BotBuilderProps) {
  return <BotBuilderInner {...props} />;
}

export default BotBuilder;
