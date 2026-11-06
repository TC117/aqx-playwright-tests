import path from 'node:path';
import { config } from 'dotenv';

config({ quiet: true });

/**
 * Typed access to the settings the tests need.
 * Values come from the process environment or a local `.env` file (see `.env.example`).
 */
export const env = {
  baseUrl: process.env.BASE_URL?.trim() ?? '',
  username: process.env.TRADER_USERNAME?.trim() ?? '',
  password: process.env.TRADER_PASSWORD ?? '',
  defaultSymbol: process.env.DEFAULT_SYMBOL?.trim() || 'EURUSD',
  isCI: Boolean(process.env.CI),
} as const;

/** True when everything needed to log in to the demo account is configured. */
export const hasCredentials = Boolean(env.baseUrl && env.username && env.password);

export const MISSING_BASE_URL_REASON = 'Set BASE_URL in .env to run tests against the web trader';

export const MISSING_CREDENTIALS_REASON =
  'Set BASE_URL, TRADER_USERNAME and TRADER_PASSWORD in .env to run tests against the demo account';

/** Where the logged-in browser state is saved by the setup project and reused by trading tests. */
export const AUTH_FILE = path.resolve(__dirname, '../../.auth/user.json');
