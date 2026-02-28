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
    },
  },
};

export function isThemeName(value) {
  return value === 'classic' || value === 'bright';
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
