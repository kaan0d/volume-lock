import * as storage from './lib/storage';

// exposed so Playwright can call storage functions inside the real extension
(globalThis as unknown as { svsStorage: typeof storage }).svsStorage = storage;
