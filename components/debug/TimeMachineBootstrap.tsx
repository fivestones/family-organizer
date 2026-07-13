import { isTimeMachineEnabled } from '@/lib/time-machine-config';

export const TIME_MACHINE_SCRIPT = `
  (function() {
    try {
      var key = 'debug_time_offset';
      var stored = localStorage.getItem(key);
      var offset = stored ? parseInt(stored, 10) : 0;

      if (offset === 0 || isNaN(offset)) return;

      var RealDate = window.Date;
      window.__RealDate = RealDate; // Backup

      class MockDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(RealDate.now() + offset);
          } else {
            super(...args);
          }
        }
        static now() {
          return RealDate.now() + offset;
        }
      }

      window.Date = MockDate;
      console.log('[TimeMachine] Early patch applied via inline script. Offset:', offset);
    } catch(e) {
      console.error('[TimeMachine] Failed to apply early patch:', e);
    }
  })();
`;

export function TimeMachineBootstrap() {
    if (!isTimeMachineEnabled()) return null;
    return <script dangerouslySetInnerHTML={{ __html: TIME_MACHINE_SCRIPT }} />;
}
