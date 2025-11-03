import express from 'express';

const app = express();
const port = process.env.PORT || 3000;


app.use(express.json())

app.all(/.*/, (req, res) => {

    console.log('Headers: ', jsonify(req.headers))
    console.log('Body: ', jsonify(req.body))


    res.status(503).send({
        'error': 'Not implemented!'
    })
});

app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});

function jsonify(obj: any): string {
    return JSON.stringify(obj, undefined, 2)
}