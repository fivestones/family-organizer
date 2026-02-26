import React from 'react';
import { ScreenScaffold, PlaceholderCard } from '../../src/components/ScreenScaffold';
import { colors } from '../../src/theme/tokens';

export default function ChoresTab() {
  return (
    <ScreenScaffold
      title="Chores"
      subtitle="Phase 2 target: date carousel, member filter, chore cards, up-for-grabs logic, and embedded task checklist."
      accent={colors.accentChores}
    >
      <PlaceholderCard
        title="Planned first"
        body="Daily flow parity: chore list, completion toggles, task checklist, completion guardrails, XP, and mobile-optimized avatars."
      />
      <PlaceholderCard
        title="Shared logic reuse"
        body="This screen will use extracted shared-core recurrence/assignment logic to keep parity with the web app behavior."
      />
    </ScreenScaffold>
  );
}

