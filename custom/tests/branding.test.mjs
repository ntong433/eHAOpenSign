import assert from 'node:assert/strict';
import test from 'node:test';

import { getBrandingConfig } from '../branding/frontend.js';

test('normalizes nested branding logo config for browser consumers', () => {
  const branding = getBrandingConfig({
    productName: 'Configured Product',
    logos: {
      app: 'https://example.test/logo.png',
      favicon: 'https://example.test/favicon.png'
    }
  });

  assert.equal(branding.productName, 'Configured Product');
  assert.equal(branding.logoUrl, 'https://example.test/logo.png');
  assert.equal(branding.faviconUrl, 'https://example.test/favicon.png');
});
