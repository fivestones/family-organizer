export const CALENDAR_DAY_HEIGHT_MIN = 84;
export const CALENDAR_DAY_HEIGHT_MAX = 220;
export const CALENDAR_DAY_HEIGHT_DEFAULT = 120;
export const CALENDAR_VISIBLE_WEEKS_MIN = 3;
export const CALENDAR_VISIBLE_WEEKS_MAX = 10;
export const CALENDAR_DAY_HEIGHT_STORAGE_KEY = 'calendar.dayCellHeightPx';
export const CALENDAR_SHOW_CHORES_STORAGE_KEY = 'calendar.showChores';

export const CALENDAR_COMMAND_EVENT = 'calendar:command';
export const CALENDAR_STATE_EVENT = 'calendar:state';

export type CalendarCommandDetail =
    | { type: 'setDayHeight'; dayHeight: number }
    | { type: 'setVisibleWeeks'; visibleWeeks: number }
    | { type: 'setShowChores'; showChores: boolean }
    | { type: 'setChoreFilter'; selectedChoreIds: string[] }
    | { type: 'setMemberFilter'; everyoneSelected: boolean; selectedMemberIds: string[] }
    | { type: 'scrollToday' }
    | { type: 'quickAdd' }
    | { type: 'requestState' };

export interface CalendarStateDetail {
    dayHeight: number;
    visibleWeeks: number;
    showChores: boolean;
    choreFilter?: {
        configured: boolean;
        selectedChoreIds: string[];
    };
    memberFilter?: {
        everyoneSelected: boolean;
        selectedMemberIds: string[];
    };
}
