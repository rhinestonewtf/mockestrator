import { Request } from "express"

export function logRequest(req: Request) {
    console.log(`${req.method} -> ${req.originalUrl} @ ${req.host}`)
    console.log(`query: ${jsonify(req.query)}`)
    console.log(`params: ${jsonify(req.params)}`)
    console.log('Headers: ', jsonify(req.headers))
    console.log('Body: ', jsonify(req.body))

}

export function jsonify(obj: any): string {
    return JSON.stringify(obj, undefined, 2)
}