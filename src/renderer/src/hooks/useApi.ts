import { useEffect } from 'react';
import type { ProgressEvent } from '@shared/types';

/** Subscribe to simulator progress events from the renderer. */
export function useSimulatorProgress(cb: (e: ProgressEvent) => void) {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return;
    const unsub = window.api.simulator.onProgress(cb);
    return () => unsub();
  }, [cb]);
}
