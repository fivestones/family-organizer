import { useState, useCallback, useMemo } from 'react';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'calendar-settings' });

const KEYS = {
  viewMode: 'cal.viewMode',
  visibleDayCount: 'cal.dayCount',
  dayRowCount: 'cal.dayRowCount',
  dayHourHeight: 'cal.dayHourHeight',
  showGregorian: 'cal.showGregorian',
  showBs: 'cal.showBs',
  excludedMemberIds: 'cal.excludedMembers',
  excludedTagIds: 'cal.excludedTags',
  agendaFontScale: 'cal.agendaFontScale',
};

const DEFAULTS = {
  viewMode: 'month',
  visibleDayCount: 1,
  dayRowCount: 1,
  dayHourHeight: 44,
  showGregorian: true,
  showBs: true,
  agendaFontScale: 1,
};

function readString(key, fallback) {
  try {
    const val = storage.getString(key);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

function readNumber(key, fallback) {
  try {
    const val = storage.getNumber(key);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key, fallback) {
  try {
    const val = storage.getBoolean(key);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

function readJsonArray(key) {
  try {
    const raw = storage.getString(key);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Hook that provides calendar settings backed by MMKV for instant persistence.
 * Reads synchronously on mount — no async flash of default state.
 */
export function useCalendarSettings() {
  const [viewMode, setViewModeState] = useState(() => readString(KEYS.viewMode, DEFAULTS.viewMode));
  const [visibleDayCount, setVisibleDayCountState] = useState(() => readNumber(KEYS.visibleDayCount, DEFAULTS.visibleDayCount));
  const [dayRowCount, setDayRowCountState] = useState(() => readNumber(KEYS.dayRowCount, DEFAULTS.dayRowCount));
  const [dayHourHeight, setDayHourHeightState] = useState(() => readNumber(KEYS.dayHourHeight, DEFAULTS.dayHourHeight));
  const [showGregorian, setShowGregorianState] = useState(() => readBool(KEYS.showGregorian, DEFAULTS.showGregorian));
  const [showBs, setShowBsState] = useState(() => readBool(KEYS.showBs, DEFAULTS.showBs));
  const [excludedMemberIds, setExcludedMemberIdsState] = useState(() => readJsonArray(KEYS.excludedMemberIds));
  const [excludedTagIds, setExcludedTagIdsState] = useState(() => readJsonArray(KEYS.excludedTagIds));
  const [agendaFontScale, setAgendaFontScaleState] = useState(() => readNumber(KEYS.agendaFontScale, DEFAULTS.agendaFontScale));

  const setViewMode = useCallback((value) => {
    setViewModeState(value);
    storage.set(KEYS.viewMode, value);
  }, []);

  const setVisibleDayCount = useCallback((value) => {
    const clamped = Math.max(1, Math.min(14, value));
    setVisibleDayCountState(clamped);
    storage.set(KEYS.visibleDayCount, clamped);
  }, []);

  const setDayRowCount = useCallback((value) => {
    const clamped = Math.max(1, Math.min(2, value));
    setDayRowCountState(clamped);
    storage.set(KEYS.dayRowCount, clamped);
  }, []);

  const setDayHourHeight = useCallback((value) => {
    const clamped = Math.max(32, Math.min(112, value));
    setDayHourHeightState(clamped);
    storage.set(KEYS.dayHourHeight, clamped);
  }, []);

  const setShowGregorian = useCallback((value) => {
    setShowGregorianState(value);
    storage.set(KEYS.showGregorian, value);
  }, []);

  const setShowBs = useCallback((value) => {
    setShowBsState(value);
    storage.set(KEYS.showBs, value);
  }, []);

  const setExcludedMemberIds = useCallback((value) => {
    setExcludedMemberIdsState(value);
    storage.set(KEYS.excludedMemberIds, JSON.stringify(value));
  }, []);

  const setExcludedTagIds = useCallback((value) => {
    setExcludedTagIdsState(value);
    storage.set(KEYS.excludedTagIds, JSON.stringify(value));
  }, []);

  const setAgendaFontScale = useCallback((value) => {
    const clamped = Math.max(0.82, Math.min(1.35, value));
    setAgendaFontScaleState(clamped);
    storage.set(KEYS.agendaFontScale, clamped);
  }, []);

  return {
    viewMode,
    setViewMode,
    visibleDayCount,
    setVisibleDayCount,
    dayRowCount,
    setDayRowCount,
    dayHourHeight,
    setDayHourHeight,
    showGregorian,
    setShowGregorian,
    showBs,
    setShowBs,
    excludedMemberIds,
    setExcludedMemberIds,
    excludedTagIds,
    setExcludedTagIds,
    agendaFontScale,
    setAgendaFontScale,
  };
}
