import { createBrandingRouter } from './routes/branding.js';
import { createHealthRouter } from './routes/health.js';
import { auditRequest } from './middleware/audit.js';

export function createEnterpriseApiRouter(express) {
  const router = express.Router();

  router.use(auditRequest);
  router.use('/health', createHealthRouter(express));
  router.use('/config/branding', createBrandingRouter(express));

  return router;
}
