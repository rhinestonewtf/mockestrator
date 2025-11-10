import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
    input:
        "https://raw.githubusercontent.com/rhinestonewtf/openapi/refs/heads/main/orchestrator.json",
    output: "src/gen",
    plugins: [
        "zod",
        {
            name: "@hey-api/sdk",
            validator: true,
        },
    ],
});