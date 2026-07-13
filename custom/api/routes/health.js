import { successResponse } from '../utils/response.js';

export function createHealthRouter(express) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json(
      successResponse({
        status: 'ok',
        service: 'enterprise-custom-api',
        timestamp: new Date().toISOString()
      })
    );
  });

  return router;
}
