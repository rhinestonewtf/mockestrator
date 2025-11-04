import express from 'express';
import { portfolio } from './routes/portfolio';
import { logRequest } from './log';
import { intent_route } from './routes/intent_route';

const app = express();
const port = process.env.PORT || 3000;


app.use(express.json())

app.get('/accounts/:address/portfolio', portfolio)
app.post('/intents/route', intent_route)

app.all(/.*/, (req, res) => {

    logRequest(req)

    res.status(503).send({
        'error': 'Not implemented!'
    })
});

app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});
