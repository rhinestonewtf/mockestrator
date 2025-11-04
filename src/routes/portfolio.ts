import { Request, Response } from "express";
import { Address } from "viem";
import { logRequest } from "../log";

export const portfolio = async (req: Request, resp: Response) => {
    logRequest(req)

    const userAddress = req.params.address as Address

    resp.status(200).send({
        'data': 'lets pretend here is balance'
    })
}