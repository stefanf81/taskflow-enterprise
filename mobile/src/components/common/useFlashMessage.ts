import { useEffect, useRef, useState } from 'react';

/** How long a flash message stays up unless it is dismissed or replaced. */
export const FLASH_DURATION_MS = 4500;

type Timer = ReturnType<typeof setTimeout>;

/** One auto-dismissing message slot. Its timer is cleared on dismiss, replacement and unmount. */
function useTimedMessage(durationMs: number) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<Timer | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // No state update after unmount: a pending timer dies with the screen.
  useEffect(() => clearTimer, []);

  const show = (next: string) => {
    clearTimer();
    setMessage(next);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMessage(null);
    }, durationMs);
  };

  const dismiss = () => {
    clearTimer();
    setMessage(null);
  };

  return { message, show, dismiss };
}

export interface FlashMessages {
  successMessage: string | null;
  errorMessage: string | null;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  dismissSuccess: () => void;
  dismissError: () => void;
}

/**
 * Timed success and error banners for a screen. Each kind has its own timer, so a later error no
 * longer cancels the dismissal of an earlier success (which then stayed up until tapped away).
 */
export function useFlashMessage(durationMs = FLASH_DURATION_MS): FlashMessages {
  const success = useTimedMessage(durationMs);
  const error = useTimedMessage(durationMs);
  return {
    successMessage: success.message,
    errorMessage: error.message,
    showSuccess: success.show,
    showError: error.show,
    dismissSuccess: success.dismiss,
    dismissError: error.dismiss,
  };
}
