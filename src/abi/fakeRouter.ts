export const fakeRouterAbi = [
    {
        type: "function",
        name: "mockFill",
        inputs: [
            {
                name: "mockFills",
                type: "tuple[]",
                internalType: "struct MockRouter.MockFillCall[]",
                components: [
                    {
                        name: "target",
                        type: "address",
                        internalType: "address"
                    },
                    {
                        "name": "callData",
                        "type": "bytes",
                        "internalType": "bytes"
                    }
                ]
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    }
] as const