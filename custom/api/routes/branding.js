import { getBrandingConfig } from '../../services/configService.js';
import { successResponse, errorResponse } from '../utils/response.js';

export function createBrandingRouter(express) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    try {
      res.json(successResponse(getBrandingConfig()));
    } catch (error) {
      res.status(500).json(errorResponse('BRANDING_CONFIG_UNAVAILABLE', error.message));
    }
  });

  return router;
}
