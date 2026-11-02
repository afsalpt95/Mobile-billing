/* eslint-disable no-console */
const ts = () => new Date().toISOString();
const quiet = () => process.env.NODE_ENV === 'test';

export const logger = {
  info: (...args: unknown[]) => !quiet() && console.log(`[${ts()}] INFO`, ...args),
  warn: (...args: unknown[]) => !quiet() && console.warn(`[${ts()}] WARN`, ...args),
  error: (...args: unknown[]) => console.error(`[${ts()}] ERROR`, ...args),
};
