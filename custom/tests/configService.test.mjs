import assert from 'node:assert/strict';
import test from 'node:test';

import { getBrandingConfig, getConfig, listConfigNames } from '../services/configService.js';

test('loads enterprise config files from the repository config directory', () => {
  const names = listConfigNames();

  assert.ok(names.includes('branding'));
  assert.ok(names.includes('features'));
});

test('merges branding and company config', () => {
  const branding = getBrandingConfig();

  assert.equal(typeof branding.productName, 'string');
  assert.equal(typeof branding.companyName, 'string');
  assert.ok(branding.colors.primary);
});

test('loads database class names for the custom layer', () => {
  const database = getConfig('database');

  assert.equal(typeof database.classes.audit, 'string');
  assert.ok(database.classes.audit.endsWith('_audit'));
});
