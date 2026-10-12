/** What every live read returns. `data` is always usable; while loading it holds the read's empty value. */
export interface QueryResult<T> {
    data: T;
    isLoading: boolean;
    error: Error | undefined;
}

/** Options every live read accepts. */
export interface ReadOptions {
    /** Pass `false` to hold the read back, for instance until someone is signed in. It then reports loading. */
    enabled?: boolean;
}
