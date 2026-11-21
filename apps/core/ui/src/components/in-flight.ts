import { useCallback, useRef, useState } from 'react';

/**
 * One request at a time for a control: `run(fn)` starts `fn` only when nothing it started is still in flight, so a
 * double click, a second Enter or a re-fired change cannot send the same mutation twice. `busy` disables the control;
 * the ref closes the gap before React re-renders it as disabled.
 */
export function useInFlight() {
  const flying = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (flying.current) return undefined;
    flying.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      flying.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
