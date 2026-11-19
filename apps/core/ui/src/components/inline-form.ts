import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

const FIELDS = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * An inline form (accept risk, evidence, triage): focus moves to its first field when it opens, and Escape cancels it.
 * Spread `formProps` onto the <form>.
 */
export function useInlineForm(onCancel: () => void) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FIELDS)?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };
  return { ref, onKeyDown };
}

/**
 * Puts focus back on the control that opened an inline form once the form closes. The control may have re-mounted
 * meanwhile, so it is found again by selector inside `root`. Call `returnTo(selector)` when the form opens.
 */
export function useFocusReturn(open: boolean, root: RefObject<HTMLElement | null>) {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (open || !target) return;
    root.current?.querySelector<HTMLElement>(target)?.focus();
    setTarget(null);
  }, [open, target, root]);
  return setTarget;
}
