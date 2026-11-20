import cloudflare from '@cloudflare/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  ...cloudflare,
  rules: {
    ...cloudflare.rules,
    // Project rules from the project guides (TP-16), on top of the preset.
    'no-nested-ternary': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  },
});
