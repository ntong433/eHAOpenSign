import { getDatabaseConfig } from './configService.js';

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'unserializable_audit_event' });
  }
}

export async function recordAuditEvent(event) {
  const payload = {
    ...event,
    occurredAt: event.occurredAt || new Date().toISOString()
  };

  console.info(`[enterprise-audit] ${safeJson(payload)}`);

  const ParseGlobal = globalThis.Parse;
  if (!ParseGlobal?.Object) {
    return { persisted: false, reason: 'parse_unavailable' };
  }

  try {
    const database = getDatabaseConfig();
    const AuditObject = ParseGlobal.Object.extend(database.classes.audit);
    const auditRecord = new AuditObject();
    Object.entries(payload).forEach(([key, value]) => auditRecord.set(key, value));
    await auditRecord.save(null, { useMasterKey: true });
    return { persisted: true };
  } catch (error) {
    console.warn('Unable to persist enterprise audit event:', error.message);
    return { persisted: false, reason: error.message };
  }
}
