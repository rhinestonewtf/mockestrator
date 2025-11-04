import { Request, Response } from "express";
import { logRequest } from "../log";


export const intent_route = async (req: Request, resp: Response) => {
    logRequest(req)
    resp.status(400).send({
        'error': 'Sorry no implementation'
    })
}