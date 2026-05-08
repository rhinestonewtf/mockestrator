import type { NextFunction, Request, Response } from 'express';
import { ApiError, sendError } from './errors';

export const SUPPORTED_API_VERSION = '2026-04.blanc';

const VERSION_PATTERN = /^\d{4}-\d{2}\.[a-z0-9]+$/;

export function requireApiVersion(req: Request, resp: Response, next: NextFunction): void {
    const header = req.headers['x-api-version'];
    if (typeof header === 'string' && header.length > 0) {
        if (!VERSION_PATTERN.test(header)) {
            sendError(resp, new ApiError(400, 'VALIDATION_ERROR', `Malformed x-api-version header: ${header}`));
            return;
        }
        if (header !== SUPPORTED_API_VERSION) {
            sendError(
                resp,
                new ApiError(
                    400,
                    'VALIDATION_ERROR',
                    `Unsupported x-api-version: ${header}. Mockestrator only supports ${SUPPORTED_API_VERSION}.`,
                ),
            );
            return;
        }
    }
    next();
}
