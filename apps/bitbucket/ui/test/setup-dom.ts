// jsdom lacks matchMedia (Atlaskit reads it at import time). Imported first by every DOM test.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
}
// waitFor/findBy default to 1 s, which flakes when the machine is busy; a real failure still fails, just later.
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 15_000 });
export {};
