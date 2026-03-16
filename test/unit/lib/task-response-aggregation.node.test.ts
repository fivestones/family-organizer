import { describe, expect, it } from 'vitest';
import {
    computeSeriesGrade,
    getNeedsReviewTasks,
    getRecentlyGradedTasks,
} from '@/lib/task-response-aggregation';

const makeGradeType = (id = 'pct') => [
    { id, kind: 'number', name: 'Percentage', highValue: 100 },
];

const makeTask = (
    id: string,
    overrides: {
        weight?: number;
        responseFields?: Array<{ id: string; required: boolean }>;
        responses?: any[];
    } = {}
) => ({
    id,
    weight: overrides.weight,
    responseFields: overrides.responseFields || [{ id: `field-${id}`, required: true }],
    responses: overrides.responses || [],
});

describe('computeSeriesGrade', () => {
    it('returns null when no tasks have response fields', () => {
        const tasks = [makeTask('t1', { responseFields: [] })];
        expect(computeSeriesGrade(tasks)).toBeNull();
    });

    it('returns 0 graded count when no responses are graded', () => {
        const tasks = [
            makeTask('t1', {
                responses: [{ id: 'r1', status: 'submitted', version: 1, grades: [] }],
            }),
        ];
        const result = computeSeriesGrade(tasks);
        expect(result).not.toBeNull();
        expect(result!.gradedCount).toBe(0);
        expect(result!.totalGradable).toBe(1);
    });

    it('computes simple average when all weights are 0', () => {
        const tasks = [
            makeTask('t1', {
                weight: 0,
                responses: [
                    {
                        id: 'r1',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g1', numericValue: 80, displayValue: '80', gradeType: makeGradeType() },
                        ],
                    },
                ],
            }),
            makeTask('t2', {
                weight: 0,
                responses: [
                    {
                        id: 'r2',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g2', numericValue: 90, displayValue: '90', gradeType: makeGradeType() },
                        ],
                    },
                ],
            }),
        ];
        const result = computeSeriesGrade(tasks);
        expect(result!.average).toBe(85);
        expect(result!.gradedCount).toBe(2);
        expect(result!.totalGradable).toBe(2);
    });

    it('computes weighted average when tasks have weights', () => {
        const tasks = [
            makeTask('t1', {
                weight: 2,
                responses: [
                    {
                        id: 'r1',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g1', numericValue: 100, displayValue: '100', gradeType: makeGradeType() },
                        ],
                    },
                ],
            }),
            makeTask('t2', {
                weight: 1,
                responses: [
                    {
                        id: 'r2',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g2', numericValue: 70, displayValue: '70', gradeType: makeGradeType() },
                        ],
                    },
                ],
            }),
        ];
        const result = computeSeriesGrade(tasks);
        // (100*2 + 70*1) / (2+1) = 270/3 = 90
        expect(result!.average).toBe(90);
    });

    it('uses latest graded version when multiple exist', () => {
        const tasks = [
            makeTask('t1', {
                responses: [
                    {
                        id: 'r1',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g1', numericValue: 60, displayValue: '60', gradeType: makeGradeType() },
                        ],
                    },
                    {
                        id: 'r2',
                        status: 'graded',
                        version: 2,
                        grades: [
                            { id: 'g2', numericValue: 95, displayValue: '95', gradeType: makeGradeType() },
                        ],
                    },
                ],
            }),
        ];
        const result = computeSeriesGrade(tasks);
        expect(result!.average).toBe(95);
    });

    it('skips ungraded tasks in average', () => {
        const tasks = [
            makeTask('t1', {
                responses: [
                    {
                        id: 'r1',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g1', numericValue: 80, displayValue: '80', gradeType: makeGradeType() },
                        ],
                    },
                ],
            }),
            makeTask('t2', {
                responses: [{ id: 'r2', status: 'submitted', version: 1, grades: [] }],
            }),
        ];
        const result = computeSeriesGrade(tasks);
        expect(result!.average).toBe(80);
        expect(result!.gradedCount).toBe(1);
        expect(result!.totalGradable).toBe(2);
    });

    it('averages per-field grades for a task', () => {
        const tasks = [
            makeTask('t1', {
                responseFields: [
                    { id: 'f1', required: true },
                    { id: 'f2', required: true },
                ],
                responses: [
                    {
                        id: 'r1',
                        status: 'graded',
                        version: 1,
                        grades: [
                            { id: 'g1', numericValue: 80, displayValue: '80', gradeType: makeGradeType(), field: [{ id: 'f1' }] },
                            { id: 'g2', numericValue: 100, displayValue: '100', gradeType: makeGradeType(), field: [{ id: 'f2' }] },
                        ],
                    },
                ],
            }),
        ];
        const result = computeSeriesGrade(tasks);
        expect(result!.average).toBe(90);
    });
});

describe('getNeedsReviewTasks', () => {
    it('returns tasks with submitted responses', () => {
        const tasks = [
            makeTask('t1', { responses: [{ id: 'r1', status: 'submitted', version: 1 }] }),
            makeTask('t2', { responses: [{ id: 'r2', status: 'graded', version: 1 }] }),
            makeTask('t3', { responses: [{ id: 'r3', status: 'draft', version: 1 }] }),
        ];
        const result = getNeedsReviewTasks(tasks);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('t1');
    });
});

describe('getRecentlyGradedTasks', () => {
    it('returns graded tasks sorted by most recent', () => {
        const tasks = [
            makeTask('t1', {
                responses: [
                    {
                        id: 'r1',
                        status: 'graded',
                        version: 1,
                        submittedAt: 1000,
                        grades: [{ id: 'g1', numericValue: 90, displayValue: '90' }],
                    },
                ],
            }),
            makeTask('t2', {
                responses: [
                    {
                        id: 'r2',
                        status: 'graded',
                        version: 1,
                        submittedAt: 2000,
                        grades: [{ id: 'g2', numericValue: 85, displayValue: '85' }],
                    },
                ],
            }),
        ];
        const result = getRecentlyGradedTasks(tasks);
        expect(result).toHaveLength(2);
        expect(result[0].task.id).toBe('t2');
        expect(result[1].task.id).toBe('t1');
    });

    it('respects limit', () => {
        const tasks = Array.from({ length: 10 }, (_, i) =>
            makeTask(`t${i}`, {
                responses: [
                    {
                        id: `r${i}`,
                        status: 'graded',
                        version: 1,
                        submittedAt: i * 1000,
                        grades: [{ id: `g${i}`, numericValue: 80, displayValue: '80' }],
                    },
                ],
            })
        );
        const result = getRecentlyGradedTasks(tasks, 3);
        expect(result).toHaveLength(3);
    });
});
