export const TASK_UPLOAD_OBJECT_PREFIXES = [
    'task-attachment/',
    'task-update/',
    'task-response/',
    // Mobile task uploads used this flat, but still task-specific, namespace
    // before web uploads adopted slash-delimited scopes.
    'task-attachment--',
] as const;

export const TASK_UPLOAD_SWEEP_GRACE_PERIOD_HOURS = 24;

export interface TaskUploadObject {
    key: string;
    lastModified?: Date;
    size: number;
}

export interface TaskUploadSweepPlan {
    managedObjects: number;
    managedBytes: number;
    referencedObjects: number;
    referencedBytes: number;
    graceProtectedObjects: number;
    graceProtectedBytes: number;
    orphanedObjects: TaskUploadObject[];
    orphanedBytes: number;
}

function isManagedTaskUploadKey(value: string): boolean {
    return TASK_UPLOAD_OBJECT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function decodeObjectKey(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    let candidate = trimmed;
    try {
        if (/^https?:\/\//i.test(candidate)) {
            candidate = new URL(candidate).pathname;
        } else {
            candidate = candidate.split(/[?#]/, 1)[0] || '';
        }
    } catch {
        return null;
    }

    const routePrefixes = ['/api/mobile/files/', '/files/'];
    const routePrefix = routePrefixes.find((prefix) => candidate.startsWith(prefix));
    if (routePrefix) {
        candidate = candidate.slice(routePrefix.length);
    } else if (candidate.startsWith('/')) {
        candidate = candidate.slice(1);
    }

    try {
        candidate = decodeURIComponent(candidate);
    } catch {
        return null;
    }

    return isManagedTaskUploadKey(candidate) ? candidate : null;
}

export function collectReferencedTaskUploadKeys(values: readonly unknown[]): Set<string> {
    const keys = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const key = decodeObjectKey(value);
        if (key) keys.add(key);
    }
    return keys;
}

export function planTaskUploadOrphanSweep(input: {
    objects: TaskUploadObject[];
    referencedValues: readonly unknown[];
    now?: Date;
    gracePeriodHours?: number;
}): TaskUploadSweepPlan {
    const nowMs = (input.now || new Date()).getTime();
    const gracePeriodHours = input.gracePeriodHours ?? TASK_UPLOAD_SWEEP_GRACE_PERIOD_HOURS;
    if (!Number.isFinite(gracePeriodHours) || gracePeriodHours < 0) {
        throw new Error('Invalid task upload sweep grace period');
    }
    const cutoffMs = nowMs - gracePeriodHours * 60 * 60 * 1000;
    const referencedKeys = collectReferencedTaskUploadKeys(input.referencedValues);

    const plan: TaskUploadSweepPlan = {
        managedObjects: 0,
        managedBytes: 0,
        referencedObjects: 0,
        referencedBytes: 0,
        graceProtectedObjects: 0,
        graceProtectedBytes: 0,
        orphanedObjects: [],
        orphanedBytes: 0,
    };

    const seen = new Set<string>();
    for (const object of input.objects) {
        const key = typeof object.key === 'string' ? object.key.trim() : '';
        if (!key || !isManagedTaskUploadKey(key) || seen.has(key)) continue;
        seen.add(key);

        const size = Number.isFinite(object.size) && object.size > 0 ? object.size : 0;
        plan.managedObjects += 1;
        plan.managedBytes += size;

        if (referencedKeys.has(key)) {
            plan.referencedObjects += 1;
            plan.referencedBytes += size;
            continue;
        }

        const lastModifiedMs = object.lastModified?.getTime();
        if (lastModifiedMs === undefined || !Number.isFinite(lastModifiedMs) || lastModifiedMs > cutoffMs) {
            plan.graceProtectedObjects += 1;
            plan.graceProtectedBytes += size;
            continue;
        }

        plan.orphanedObjects.push({ key, lastModified: object.lastModified, size });
        plan.orphanedBytes += size;
    }

    return plan;
}
