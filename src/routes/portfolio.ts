import { Request, Response } from "express";
import { Address } from "viem";



export const portfolio = async (req: Request, resp: Response) => {
    const userAddress = req.params.address as Address

    resp.status(200).send({
        'data': 'lets pretend here is balance'
    })
}