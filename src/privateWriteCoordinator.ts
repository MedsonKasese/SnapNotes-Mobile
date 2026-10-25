// Shared write coordinator for the ordinary notes store and encrypted vault.
// All participating writers must use the SAME coordinator instance. This does
// not make two independent storage commits atomic or provide crash recovery.
export function createPrivateWriteCoordinator() {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    pending += 1;
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      pending -= 1;
      release();
    }
  }

  return {
    exclusive,
    // Intended for UI disablement only; not an authorization or durability gate.
    isBusy: () => pending > 0,
  };
}

export type PrivateWriteCoordinator = ReturnType<typeof createPrivateWriteCoordinator>;
