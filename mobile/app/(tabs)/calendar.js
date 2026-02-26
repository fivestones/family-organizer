import React from 'react';
import { ScreenScaffold, PlaceholderCard } from '../../src/components/ScreenScaffold';
import { colors } from '../../src/theme/tokens';

export default function CalendarTab() {
  return (
    <ScreenScaffold
      title="Calendar"
      subtitle="Phase 3 target: month grid, Gregorian + Bikram Samvat labels, event create/edit, and timed/all-day event support."
      accent={colors.accentCalendar}
    >
      <PlaceholderCard
        title="Parity notes"
        body="All-day exclusive end-date semantics and denormalized year/month/day fields will be preserved using shared event mutation helpers."
      />
    </ScreenScaffold>
  );
}

