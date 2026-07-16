const lockTails = new Map<string, Promise<void>>();

export async function withFinanceMutationLocks<T>(rawKeys: readonly string[], task: () => Promise<T>): Promise<T> {
    const keys = Array.from(new Set(rawKeys.filter(Boolean))).sort();
    if (keys.length === 0) return task();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const predecessors = keys.map((key) => lockTails.get(key) || Promise.resolve());
    const tails = keys.map((key, index) => {
        const tail = predecessors[index].catch(() => undefined).then(() => gate);
        lockTails.set(key, tail);
        return tail;
    });

    await Promise.all(predecessors.map((predecessor) => predecessor.catch(() => undefined)));
    try {
        return await task();
    } finally {
        release();
        keys.forEach((key, index) => {
            if (lockTails.get(key) === tails[index]) lockTails.delete(key);
        });
    }
}
