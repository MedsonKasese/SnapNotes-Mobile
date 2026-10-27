import { createPrivateWriteCoordinator } from './privateWriteCoordinator.ts';

// Shared by ordinary notes and the encrypted vault in this JS runtime.
// Never call a coordinated save from inside an exclusive operation.
export const privateSharedCoordinator = createPrivateWriteCoordinator();
