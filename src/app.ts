import express from 'express';
import { portfolio } from './routes/portfolio';
import { logRequest } from './log';
import { quote } from './routes/quote';
import { getIntents, getIntentStatus, postIntent } from './routes/intents';
import { quoteEstimate } from './routes/quote_estimate';
import {
    appFeeBalances,
    createAppFeeWithdrawal,
    getAppFeeWithdrawal,
    listAppFeeWithdrawals,
} from './routes/app_fees';
import { intent_split } from './routes/intent_split';
import { chains } from './routes/chains';
import { liquidity } from './routes/liquidity';
import './serializeBigInts';
import { initContexts } from './chains';
import { requireApiVersion } from './version';
import { sendError } from './errors';
import { ApiError } from './errors';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(requireApiVersion);

app.get('/accounts/:accountAddress/portfolio', portfolio);
app.post('/quotes', quote);
app.post('/quotes/estimate', quoteEstimate);
app.post('/intents', postIntent);
app.get('/intents', getIntents);
app.post('/intents/splits', intent_split);
app.get('/intents/:id', getIntentStatus);
app.get('/chains', chains);
app.get('/liquidity', liquidity);
app.get('/app-fees/balances', appFeeBalances);
app.get('/app-fees/withdrawals', listAppFeeWithdrawals);
app.post('/app-fees/withdrawals', createAppFeeWithdrawal);
app.get('/app-fees/withdrawals/:nonce', getAppFeeWithdrawal);

app.all(/.*/, (req, res) => {
    console.log('**** Unmapped request ****');
    logRequest(req);
    sendError(res, new ApiError(404, 'NOT_FOUND', `Not implemented: ${req.method} ${req.path}`));
});

(async () => {
    await initContexts();
    app.listen(port, () => {
        console.log(`🚀 Server running on http://localhost:${port}`);
    });
})();
