// In-memory only. A result from an old foreground session must never unlock
// the UI after backgrounding, leaving Private Notes or starting another attempt.
export function createPrivateSession() {
  let generation = 0;
  let active = true;
  let pending: number | null = null;

  function invalidate(): void {
    generation += 1;
    pending = null;
  }

  return {
    begin(): number | null {
      if (!active || pending !== null) return null;
      // Each attempt owns a distinct token, even within the same foreground session.
      generation += 1;
      pending = generation;
      return generation;
    },
    valid(token: number): boolean {
      return active && generation === token;
    },
    finish(token: number): void {
      // A late completion must not release a newer attempt's pending guard.
      if (pending === token) pending = null;
    },
    invalidate,
    setActive(value: boolean): void {
      if (!value) invalidate();
      active = value;
    },
  };
}
