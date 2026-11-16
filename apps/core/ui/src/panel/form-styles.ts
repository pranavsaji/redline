import type { CSSProperties } from 'react';
import { token } from '@atlaskit/tokens';

/** Native controls styled with design tokens (light and dark). */
export const field: CSSProperties = {
  font: token('font.body'),
  color: token('color.text'),
  background: token('color.background.input'),
  border: `1px solid ${token('color.border.input')}`,
  borderRadius: 4,
  padding: '4px 6px',
  minHeight: 32,
  boxSizing: 'border-box',
  maxWidth: '100%',
};
export const label: CSSProperties = { font: token('font.body.small'), color: token('color.text.subtle'), display: 'grid', gap: 2 };
export const errorText: CSSProperties = { margin: 0, color: token('color.text.danger'), font: token('font.body.small') };
export const box: CSSProperties = { display: 'grid', gap: 8, padding: 10, borderRadius: 6, border: `1px solid ${token('color.border')}`, background: token('elevation.surface.sunken') };
