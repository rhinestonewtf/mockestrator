// Express' qs parser yields strings (or arrays of strings) for every query value,
// while the generated schemas expect the JSON types the spec declares. Coerce
// before validating — unrecognised values are passed through untouched so they
// still fail validation rather than being silently reinterpreted.

export const queryArray = (value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? (value as string[]) : [value as string];
};

export const queryBoolean = (value: unknown): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
};
