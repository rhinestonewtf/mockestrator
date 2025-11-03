import express, { Request } from 'express';
import { portfolio } from './routes/portfolio';

const app = express();
const port = process.env.PORT || 3000;


app.use(express.json())

app.get('/accounts/:address/portfolio', portfolio)

app.all(/.*/, (req, res) => {

    logRequest(req)

    res.status(503).send({
        'error': 'Not implemented!'
    })
});

app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});

function logRequest(req: Request) {
    console.log(`${req.method} -> ${req.originalUrl} @ ${req.host}`)
    console.log('Headers: ', jsonify(req.headers))
    console.log('Body: ', jsonify(req.body))

}

function jsonify(obj: any): string {
    return JSON.stringify(obj, undefined, 2)
}