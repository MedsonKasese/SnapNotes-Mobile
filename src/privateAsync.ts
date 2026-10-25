// A deadline stops waiting, not the underlying native work. Callers must keep
// their concurrency guard until that work actually settles. Never use this on
// a write: its completion could otherwise be mistaken for a failed commit.
export class PrivateOperationTimeoutError extends Error {
  constructor() {
    super('Private Notes took too long. No unlock was granted. [PV-TIMEOUT]');
    this.name = 'PrivateOperationTimeoutError';
  }
}

export function waitForPrivateOperation<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PrivateOperationTimeoutError()), timeoutMs);
    work.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
