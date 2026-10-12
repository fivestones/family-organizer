/**
 * The parts of an InstantDB client the Instant implementation uses. The web and the phone each pass their own:
 * `@instantdb/react` on one, `@instantdb/react-native` on the other.
 */
export interface InstantClient {
    db: {
        useQuery(query: unknown): { data?: any; isLoading: boolean; error?: { message: string } | undefined };
        queryOnce(query: unknown): Promise<{ data: any }>;
        transact(chunks: unknown): Promise<unknown>;
    };
    tx: any;
    id(): string;
}

export function toError(error: { message: string } | undefined): Error | undefined {
    return error ? new Error(error.message) : undefined;
}
