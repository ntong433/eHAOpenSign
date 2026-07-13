import { recordAuditEvent } from '../../services/auditService.js';

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

export function auditRequest(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    recordAuditEvent({
      action: 'enterprise_api_request',
      category: 'api',
      statusCode: res.statusCode,
      method: req.method,
      path: req.originalUrl,
      ipAddress: getRequestIp(req),
      userAgent: req.headers['user-agent'] || '',
      durationMs: Date.now() - startedAt
    }).catch(error => {
      console.warn('Enterprise audit logging failed:', error.message);
    });
  });

  next();
}
