import { Request, Response } from 'express';
import { getAddress, zeroAddress, zeroHash } from 'viem';
import { z } from 'zod';
import { jsonify, logRequest } from '../log';
import {
    zCreateAppFeeWithdrawalData,
    zCreateAppFeeWithdrawalResponse,
    zGetAppFeeBalancesResponse,
    zGetAppFeeWithdrawalData,
    zGetAppFeeWithdrawalResponse,
    zListAppFeeWithdrawalsResponse,
} from '../gen/zod.gen';
import { ApiError, sendError } from '../errors';

type Balances = z.infer<typeof zGetAppFeeBalancesResponse>;
type Withdrawal = z.infer<typeof zGetAppFeeWithdrawalResponse>;
type WithdrawalList = z.infer<typeof zListAppFeeWithdrawalsResponse>;
type CreateResponse = z.infer<typeof zCreateAppFeeWithdrawalResponse>;

// The mock accrues no app fees, so balances are always zero and withdrawals only
// ever reflect what a caller requested in this process.
const withdrawals = new Map<string, Withdrawal>();
let nextNonce = 1;

export const appFeeBalances = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const out: Balances = { withdrawableUsd: 0, pendingUsd: 0 };
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

export const listAppFeeWithdrawals = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const out: WithdrawalList = { withdrawals: Array.from(withdrawals.values()) };
        console.log('Response: ', jsonify(out));
        resp.status(200).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

export const createAppFeeWithdrawal = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zCreateAppFeeWithdrawalData.parse({
            body: req.body,
            path: undefined,
            query: undefined,
            headers: req.headers,
        });
        const body = data.body;
        if (!body) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Missing request body');
        }

        const requestNonce = String(nextNonce++);
        withdrawals.set(requestNonce, {
            requestNonce,
            status: 'PENDING',
            payoutUsd: 0,
            targetChainId: body.targetChainId,
            targetToken: getAddress(body.targetToken),
            targetAmount: '0',
            payoutAddress: zeroAddress,
            txHash: zeroHash,
            createdAt: new Date().toISOString(),
        });

        const out: CreateResponse = { requestNonce };
        console.log('Response: ', jsonify(out));
        resp.status(202).json(out);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};

export const getAppFeeWithdrawal = async (req: Request, resp: Response) => {
    logRequest(req);

    try {
        const data = zGetAppFeeWithdrawalData.parse({
            body: undefined,
            path: req.params,
            query: undefined,
            headers: req.headers,
        });
        const withdrawal = withdrawals.get(data.path.nonce);
        if (!withdrawal) {
            throw new ApiError(404, 'NOT_FOUND', `Withdrawal not found: ${data.path.nonce}`);
        }
        console.log('Response: ', jsonify(withdrawal));
        resp.status(200).json(withdrawal);
    } catch (e) {
        console.log(e);
        sendError(resp, e);
    }
};
