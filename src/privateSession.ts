// In-memory only. A result from an old foreground session must never unlock
// the UI after backgrounding, leaving Private Notes or starting another attempt.
export function createPrivateSession() {
  let generation = 0;
  let active = true;
  let pending = false;
  return {
    begin(): number | null {
      if (!active || pending) return null;
      pending = true;
      return generation;
    },
    valid(token: number): boolean {
      return active && generation === token;
    },
    finish(): void { pending = false; },
    invalidate(): void { generation += 1; pending = false; },
    setActive(value: boolean): void {
      if (!value) this.invalidate();
      active = value;
    },
  };
}
