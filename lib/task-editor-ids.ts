export interface TaskNodeIdentity {
    pos: number;
    id?: string | null;
}

/**
 * Plan fresh IDs for every task node that is not an explicitly preserved
 * pre-transaction node. Preserved duplicate IDs are repaired after the first
 * occurrence, and generated IDs may never collide with an ID kept in the doc.
 */
export function buildTaskIdRepairPlan(
    nodes: TaskNodeIdentity[],
    preservedPositions: ReadonlySet<number>,
    createId: () => string
): Map<number, string> {
    const usedIds = new Set<string>();
    const keptPositions = new Set<number>();

    for (const node of nodes) {
        const nodeId = typeof node.id === 'string' ? node.id.trim() : '';
        if (!nodeId || !preservedPositions.has(node.pos) || usedIds.has(nodeId)) continue;
        usedIds.add(nodeId);
        keptPositions.add(node.pos);
    }

    const repairs = new Map<number, string>();
    for (const node of nodes) {
        if (keptPositions.has(node.pos)) continue;

        let nextId = '';
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const candidate = createId();
            if (candidate && !usedIds.has(candidate)) {
                nextId = candidate;
                break;
            }
        }
        if (!nextId) {
            throw new Error('Unable to allocate a unique task ID');
        }

        usedIds.add(nextId);
        repairs.set(node.pos, nextId);
    }

    return repairs;
}
