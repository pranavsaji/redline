import type { CSSProperties } from 'react';
import { token } from '@atlaskit/tokens';

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
export const box: CSSProperties = { display: 'grid', gap: 8, padding: 12, borderRadius: 6, border: `1px solid ${token('color.border')}` };
