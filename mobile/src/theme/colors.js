export const COLORS = {
  primary:      '#E88A1A',
  primaryDeep:  '#C97516',
  black:        '#0F172A',
  white:        '#FFFFFF',
  bg:           '#F8FAFC',
  card:         '#FFFFFF',
  border:       '#E2E8F0',
  muted:        '#64748B',
  lightMuted:   '#94A3B8',
  lightBg:      '#F1F5F9',
  danger:       '#EF4444',
  success:      '#059669',
  warning:      '#D97706',
};

export const TINTS = {
  orange:  { bg: '#FFF7ED', fg: '#E88A1A' },
  blue:    { bg: '#EFF6FF', fg: '#2563EB' },
  violet:  { bg: '#F5F3FF', fg: '#7C3AED' },
  emerald: { bg: '#ECFDF5', fg: '#059669' },
  red:     { bg: '#FEF2F2', fg: '#EF4444' },
  amber:   { bg: '#FFFBEB', fg: '#D97706' },
  purple:  { bg: '#FAF5FF', fg: '#9333EA' },
  slate:   { bg: '#F1F5F9', fg: '#64748B' },
  cyan:    { bg: '#ECFEFF', fg: '#0891B2' },
};

export const RADIUS = { sm: 10, md: 12, lg: 14, xl: 16, '2xl': 18 };

export const SHADOW = {
  sm: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
};

export const FONTS = {
  regular: { fontSize: 14, color: COLORS.black },
  bold:    { fontSize: 14, fontWeight: '700', color: COLORS.black },
  h1:      { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  h2:      { fontSize: 18, fontWeight: '800', color: COLORS.black, letterSpacing: -0.3 },
  caption: { fontSize: 12, color: COLORS.muted },
  small:   { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.lightMuted },
};
