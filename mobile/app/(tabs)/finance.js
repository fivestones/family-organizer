import React from 'react';
import { ScreenScaffold, PlaceholderCard } from '../../src/components/ScreenScaffold';
import { colors } from '../../src/theme/tokens';

export default function FinanceTab() {
  return (
    <ScreenScaffold
      title="Finance"
      subtitle="Phase 3 target: envelopes, transfers, withdrawals, transaction history, combined balances, and allowance configuration."
      accent={colors.accentFinance}
    >
      <PlaceholderCard
        title="Allowance parity"
        body="This tab will reuse shared allowance period and currency conversion logic to match the web allowance calculations exactly."
      />
      <PlaceholderCard
        title="Online-only admin flow"
        body="Allowance distribution execution remains a parent-only online workflow with explicit sync and error states."
      />
    </ScreenScaffold>
  );
}

