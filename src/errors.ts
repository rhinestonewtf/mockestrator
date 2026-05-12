import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { ZodError } from 'zod';

export type ErrorCode =
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'CONFLICT'
    | 'UNPROCESSABLE_CONTENT'
    | 'TOO_MANY_REQUESTS'
    | 'INSUFFICIENT_LIQUIDITY'
    | 'SETTLEMENT_QUOTE_ERROR'
    | 'SETTLEMENT_EXECUTION_ERROR'
    | 'EXTERNAL_SERVICE_TIMEOUT'
    | 'RELAYER_MARKET_UNAVAILABLE'
    | 'INTERNAL_ERROR';

export type ErrorEnvelope = {
    code: ErrorCode;
    message: string;
    traceId: string;
    details?: unknown;
};

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: ErrorCode,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

function newTraceId(): string {
    return randomBytes(16).toString('hex');
}

export function sendError(resp: Response, error: unknown): void {
    if (error instanceof ApiError) {
        const envelope: ErrorEnvelope = {
            code: error.code,
            message: error.message,
            traceId: newTraceId(),
        };
        if (error.details !== undefined) envelope.details = error.details;
        resp.status(error.status).json(envelope);
        return;
    }

    if (error instanceof ZodError) {
        const envelope: ErrorEnvelope = {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            traceId: newTraceId(),
            details: error.issues.map((issue) => ({
                message: issue.message,
                context: { path: issue.path.join('.') },
            })),
        };
        resp.status(400).json(envelope);
        return;
    }

    const envelope: ErrorEnvelope = {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
        traceId: newTraceId(),
    };
    resp.status(500).json(envelope);
}
