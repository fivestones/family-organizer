export const DEFAULT_THEME_NAME = 'classic';

export const themes = {
  classic: {
    id: 'classic',
    label: 'Warm Classic',
    description: 'Soft sand neutrals with earthy module accents.',
    preview: ['#B4603F', '#D46A4C', '#2D7E7A', '#3A6A33', '#6E5B8C'],
    colors: {
      bg: '#F5F0E6',
      panel: '#FFF9ED',
      panelElevated: '#FFFFFF',
      ink: '#1D1A14',
      inkMuted: '#645A47',
      line: '#DCCFB8',
      accentDashboard: '#B4603F',
      accentChores: '#D46A4C',
      accentCalendar: '#2D7E7A',
      accentFinance: '#3A6A33',
      accentMore: '#6E5B8C',
      warning: '#AA5B12',
      danger: '#A93A2E',
      success: '#2E7D4C',
      locked: '#C9C0B2',
      onAccent: '#FFF8F1',
    },
  },
  bright: {
    id: 'bright',
    label: 'Sunlit Pop',
    description: 'Brighter coral, teal, leaf, and lilac accents with a lighter backdrop.',
    preview: ['#E36A42', '#F08C44', '#0D9D97', '#4A9A43', '#7B63E8'],
    colors: {
      bg: '#FBF5EC',
      panel: '#FFFDF7',
      panelElevated: '#FFFFFF',
      ink: '#1F1C17',
      inkMuted: '#6A645C',
      line: '#E3D6C8',
      accentDashboard: '#E36A42',
      accentChores: '#F08C44',
      accentCalendar: '#0D9D97',
      accentFinance: '#4A9A43',
      accentMore: '#7B63E8',
      warning: '#C47414',
      danger: '#D64A3A',
      success: '#2F9A67',
      locked: '#CFC6BA',
      onAccent: '#FFF9F3',
    },
  },
  paper: {
    id: 'paper',
    label: 'Bright Paper',
    description: 'Plain white surfaces with punchier coral, tangerine, aqua, leaf, and iris accents.',
    preview: ['#FF5B2E', '#FF8A1F', '#00B9B2', '#49B84C', '#7A5CFF'],
    colors: {
      bg: '#FFFFFF',
      panel: '#FFFFFF',
      panelElevated: '#FFFFFF',
      ink: '#181612',
      inkMuted: '#6B645A',
      line: '#E6E1D7',
      accentDashboard: '#FF5B2E',
      accentChores: '#FF8A1F',
      accentCalendar: '#00B9B2',
      accentFinance: '#49B84C',
      accentMore: '#7A5CFF',
      warning: '#D88312',
      danger: '#E34D40',
      success: '#1FA36C',
      locked: '#CEC7BE',
      onAccent: '#FFFDF8',
    },
  },
  dark: {
    id: 'dark',
    label: 'Night Mode',
    description: 'Graphite surfaces with luminous family-module accents and warm readable text.',
    preview: ['#D95A36', '#E17828', '#139A96', '#3F9A44', '#6F5BE6'],
    colors: {
      bg: '#0D1115',
      panel: '#151B21',
      panelElevated: '#1B232C',
      ink: '#F4EEE4',
      inkMuted: '#B4AB9F',
      line: '#2E3842',
      accentDashboard: '#D95A36',
      accentChores: '#E17828',
      accentCalendar: '#139A96',
      accentFinance: '#3F9A44',
      accentMore: '#6F5BE6',
      warning: '#D58A24',
      danger: '#E26455',
      success: '#3DB074',
      locked: '#5E6975',
      onAccent: '#FFFDF8',
    },
  },
};

export function isThemeName(value) {
  return Object.prototype.hasOwnProperty.call(themes, value);
}

export function getThemeDefinition(themeName) {
  return themes[isThemeName(themeName) ? themeName : DEFAULT_THEME_NAME];
}

export function getThemeColors(themeName) {
  return getThemeDefinition(themeName).colors;
}

export const themeOptions = Object.values(themes).map(({ id, label, description, preview }) => ({
  id,
  label,
  description,
  preview,
}));

export const colors = getThemeColors(DEFAULT_THEME_NAME);

export function withAlpha(hex, alpha) {
  const normalized = String(hex || '').replace('#', '').trim();
  if (normalized.length !== 3 && normalized.length !== 6) {
    return hex;
  }

  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return hex;
  }

  const clampedAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
}

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

export const shadows = {
  card: {
    shadowColor: '#5A4630',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
};
