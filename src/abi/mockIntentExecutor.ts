export const mockIntentExecutorAbi = [
  {
    type: "function",
    name: "mockFill",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "ops",
        type: "tuple",
        internalType: "struct MockIntentExecutor.Operation",
        components: [
          {
            name: "data",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "payable",
  },
] as const;
