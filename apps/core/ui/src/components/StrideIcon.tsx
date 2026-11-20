import { token } from '@atlaskit/tokens';
import type { Stride } from '../types.js';

export const STRIDE_LABEL: Record<Stride, string> = {
  Spoofing: 'Spoofing',
  Tampering: 'Tampering',
  Repudiation: 'Repudiation',
  InformationDisclosure: 'Information disclosure',
  DenialOfService: 'Denial of service',
  ElevationOfPrivilege: 'Elevation of privilege',
};

/** One stroke style for all six STRIDE glyphs (mask, wrench, pen, eye, blocked, arrow-up). */
const PATHS: Record<Stride, string> = {
  Spoofing: 'M4 8c2-2 14-2 16 0v3c0 4-3 7-8 8-5-1-8-4-8-8zM8.5 11.5h2M13.5 11.5h2',
  Tampering: 'M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z',
  Repudiation: 'M4 20h6M14 4l6 6-10 10H4v-6zM12 6l6 6',
  InformationDisclosure: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  DenialOfService: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  ElevationOfPrivilege: 'M12 20V5M6 11l6-6 6 6M5 20h14',
};

export function StrideIcon({ stride, size = 20 }: { stride: Stride; size?: number }) {
  return (
    <svg data-stride={stride} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d={PATHS[stride]} fill="none" stroke={token('color.icon.subtle')} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
