import type { ViewStyle } from 'react-native';

export const shadows = {
  subtle: {
    shadowColor: '#302B27',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  floating: {
    shadowColor: '#7C3C32',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
} satisfies Record<string, ViewStyle>;
