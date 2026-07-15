/** Normalize an Instant has-one link that may arrive as an object or a one-item array. */
export function resolveOneLink<T>(value: T | T[] | null | undefined): T | null {
    if (value == null) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
}
