import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const configDir = path.join(repoRoot, 'config');

const cache = new Map();

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

export function getConfigPath(name) {
  return path.join(configDir, `${name}.json`);
}

export function getConfig(name, options = {}) {
  const useCache = options.cache !== false;
  const filePath = getConfigPath(name);

  if (useCache && cache.has(filePath)) {
    return cache.get(filePath);
  }

  const config = readJsonFile(filePath);
  if (useCache) {
    cache.set(filePath, config);
  }
  return config;
}

export function clearConfigCache() {
  cache.clear();
}

export function listConfigNames() {
  return fs
    .readdirSync(configDir)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace(/\.json$/, ''))
    .sort();
}

export function getBrandingConfig() {
  const branding = getConfig('branding');
  const company = getConfig('company');

  return {
    ...branding,
    companyName: branding.companyName || company.companyName,
    legalName: company.legalName,
    supportEmail: company.supportEmail,
    websiteUrl: company.websiteUrl
  };
}

export function getDatabaseConfig() {
  return getConfig('database');
}
