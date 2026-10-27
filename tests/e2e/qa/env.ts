// Where the QA stack answers; the defaults are the ports qa/docker-compose.yml
// publishes.
export const HA_URL = process.env["E2E_HA_URL"] ?? "http://localhost:8123";
export const MOCK_URL = process.env["E2E_MOCK_URL"] ?? "http://localhost:8099";

/** The browser login the journeys share (written by global-setup.ts). */
export const AUTH_STATE = `${__dirname}/../../../test-results/qa-auth.json`;
