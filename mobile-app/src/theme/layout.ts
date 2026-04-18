export const spacing = {
  s2: 2,
  s3: 3,
  s4: 4,
  s5: 5,
  s6: 6,
  s7: 7,
  s8: 8,
  s9: 9,
  s10: 10,
  s11: 11,
  s12: 12,
  s13: 13,
  s14: 14,
  s16: 16,
  s17: 17,
  s18: 18,
  s20: 20,
  s22: 22,
  s24: 24,
  s26: 26,
} as const;

export const radii = {
  r8: 6,
  r10: 7,
  r11: 8,
  r12: 9,
  r13: 10,
  r14: 11,
  r16: 12,
  r18: 13,
  r20: 14,
  r22: 16,
  full: 999,
} as const;

export const sizing = {
  touchTargetMin: 44,
  iconButton: 44,
  headerActionsWidth: 112,
  bootCardMinWidth: 220,
  bootLogoSize: 74,
  tabBarBaseHeight: 70,
  appHeaderBaseHeight: 76,
} as const;

export const shadows = {
  cardStrong: {
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardMedium: {
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  tabBarRaised: {
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 12,
    elevation: 10,
  },
} as const;
