export const CALENDAR_DAY_HEIGHT_MIN = 84;
export const CALENDAR_DAY_HEIGHT_MAX = 220;
export const CALENDAR_DAY_HEIGHT_DEFAULT = 120;
export const CALENDAR_VISIBLE_WEEKS_MIN = 3;
export const CALENDAR_VISIBLE_WEEKS_MAX = 10;
export const CALENDAR_DAY_HEIGHT_STORAGE_KEY = 'calendar.dayCellHeightPx';
export const CALENDAR_SHOW_CHORES_STORAGE_KEY = 'calendar.showChores';
export const CALENDAR_VIEW_MODE_STORAGE_KEY = 'calendar.viewMode';
export const CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY = 'calendar.yearMonthBasis';
export const CALENDAR_YEAR_FONT_SCALE_MIN = 0.08;
export const CALENDAR_YEAR_FONT_SCALE_MAX = 2;
export const CALENDAR_YEAR_FONT_SCALE_DEFAULT = 0.84;
export const CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY = 'calendar.yearFontScale';
export const clampCalendarYearFontScale = (value: number) =>
    Math.round(Math.min(CALENDAR_YEAR_FONT_SCALE_MAX, Math.max(CALENDAR_YEAR_FONT_SCALE_MIN, value)) * 100) / 100;
export interface CalendarYearEventSizing {
    chipHeightPx: number;
    moreRowPx: number;
    inlinePaddingPx: number;
    borderRadiusPx: number;
    borderWidthPx: number;
}

export const getCalendarYearEventSizing = (value: number): CalendarYearEventSizing => {
    const scale = Math.min(CALENDAR_YEAR_FONT_SCALE_MAX, Math.max(CALENDAR_YEAR_FONT_SCALE_MIN, value));

    return {
        chipHeightPx: Math.max(4, Math.round(3 + scale * 11)),
        moreRowPx: Math.max(4, Math.round(3 + scale * 6)),
        inlinePaddingPx: Math.max(1, Math.round(0.5 + scale * 3.5)),
        borderRadiusPx: Math.max(2, Math.round(2 + scale * 4)),
        borderWidthPx: scale <= 0.35 ? 0.5 : 1,
    };
};
export const CALENDAR_MINI_VISIBLE_WEEKS = 5;

export const CALENDAR_COMMAND_EVENT = 'calendar:command';
export const CALENDAR_STATE_EVENT = 'calendar:state';

export type CalendarViewMode = 'monthly' | 'year';
export type CalendarYearMonthBasis = 'gregorian' | 'bs';

export type CalendarCommandDetail =
    | { type: 'setDayHeight'; dayHeight: number }
    | { type: 'setVisibleWeeks'; visibleWeeks: number }
    | { type: 'setShowChores'; showChores: boolean }
    | { type: 'setViewMode'; viewMode: CalendarViewMode }
    | { type: 'setYearMonthBasis'; yearMonthBasis: CalendarYearMonthBasis }
    | { type: 'setYearFontScale'; yearFontScale: number }
    | { type: 'shiftYearView'; direction: 'left' | 'right' }
    | { type: 'setChoreFilter'; selectedChoreIds: string[] }
    | { type: 'setTagFilter'; selectedTagIds: string[] }
    | { type: 'setMemberFilter'; everyoneSelected: boolean; selectedMemberIds: string[] }
    | { type: 'scrollToday' }
    | { type: 'quickAdd' }
    | { type: 'requestState' };

export interface CalendarStateDetail {
    dayHeight: number;
    visibleWeeks: number;
    showChores: boolean;
    viewMode: CalendarViewMode;
    yearMonthBasis: CalendarYearMonthBasis;
    yearFontScale: number;
    choreFilter?: {
        configured: boolean;
        selectedChoreIds: string[];
    };
    tagFilter?: {
        selectedTagIds: string[];
    };
    memberFilter?: {
        everyoneSelected: boolean;
        selectedMemberIds: string[];
    };
}
