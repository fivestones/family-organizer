// lib/task-response-aggregation.ts
// Utilities for computing series-level grades from individual task grades.

import type { GradeTypeLike } from './task-response-types';

interface TaskWithResponses {
    id: string;
    weight?: number;
    responseFields?: Array<{ id: string; required: boolean }>;
    responses?: Array<{
        id: string;
        status: string;
        version: number;
        submittedAt?: number;
        grades?: Array<{
            id: string;
            numericValue: number;
            displayValue: string;
            gradeType?: Array<{ id: string; kind: string; name: string; highValue?: number }>;
            field?: Array<{ id: string }>;
        }>;
    }>;
}

export interface SeriesGradeResult {
    /** Weighted (or simple) average of all graded tasks, in the grade type's native scale. */
    average: number;
    /** Number of tasks with at least one grade. */
    gradedCount: number;
    /** Number of tasks that could be graded (have response fields). */
    totalGradable: number;
    /** The grade type used (from the first graded task). */
    gradeType: GradeTypeLike | null;
}

/**
 * Compute a series-level grade from an array of tasks.
 *
 * Rules:
 * - Only tasks that have response fields are "gradable".
 * - Only the latest submitted/graded response per task is considered.
 * - If all task weights are 0 (or undefined), use a simple average.
 * - Otherwise, weighted average by task weight.
 * - Per-task grade: if the response has per-field grades (field-linked), average them
 *   (using field weights if present). Otherwise, use the overall (non-field) grade.
 */
export function computeSeriesGrade(tasks: TaskWithResponses[]): SeriesGradeResult | null {
    const gradable = tasks.filter((t) => t.responseFields && t.responseFields.length > 0);
    if (gradable.length === 0) return null;

    let gradedCount = 0;
    let weightedSum = 0;
    let weightTotal = 0;
    let detectedGradeType: GradeTypeLike | null = null;
    const allWeightsZero = gradable.every((t) => !t.weight || t.weight === 0);

    for (const task of gradable) {
        const responses = task.responses || [];
        // Find the latest graded response
        const gradedResponse = responses
            .filter((r) => r.status === 'graded')
            .sort((a, b) => (b.version || 0) - (a.version || 0))[0];

        if (!gradedResponse || !gradedResponse.grades?.length) continue;

        gradedCount++;

        // Detect grade type from first found grade
        if (!detectedGradeType && gradedResponse.grades[0]?.gradeType?.[0]) {
            const gt = gradedResponse.grades[0].gradeType[0];
            detectedGradeType = {
                id: gt.id,
                name: gt.name,
                kind: gt.kind,
                highValue: gt.highValue || 100,
                lowValue: 0,
                highLabel: String(gt.highValue || 100),
                lowLabel: '0',
                isDefault: false,
                order: 0,
            };
        }

        // Compute per-task grade
        const fieldGrades = gradedResponse.grades.filter((g) => g.field?.length);
        const overallGrades = gradedResponse.grades.filter((g) => !g.field?.length);

        let taskGrade: number;

        if (fieldGrades.length > 0) {
            // Average field grades (weighted by response field weights if available)
            const fields = task.responseFields || [];
            const fieldWeightsUsed = fields.some((f: any) => f.weight > 0);

            if (fieldWeightsUsed) {
                let fwSum = 0;
                let fwTotal = 0;
                for (const fg of fieldGrades) {
                    const fieldId = fg.field?.[0]?.id;
                    const field = fields.find((f) => f.id === fieldId);
                    const fw = (field as any)?.weight || 1;
                    fwSum += fg.numericValue * fw;
                    fwTotal += fw;
                }
                taskGrade = fwTotal > 0 ? fwSum / fwTotal : 0;
            } else {
                taskGrade = fieldGrades.reduce((sum, g) => sum + g.numericValue, 0) / fieldGrades.length;
            }
        } else if (overallGrades.length > 0) {
            taskGrade = overallGrades[0].numericValue;
        } else {
            continue;
        }

        const taskWeight = allWeightsZero ? 1 : (task.weight || 1);
        weightedSum += taskGrade * taskWeight;
        weightTotal += taskWeight;
    }

    if (gradedCount === 0 || weightTotal === 0) {
        return {
            average: 0,
            gradedCount: 0,
            totalGradable: gradable.length,
            gradeType: detectedGradeType,
        };
    }

    return {
        average: weightedSum / weightTotal,
        gradedCount,
        totalGradable: gradable.length,
        gradeType: detectedGradeType,
    };
}

/**
 * Get tasks that are in "needs_review" status (have submitted responses pending grading).
 */
export function getNeedsReviewTasks(tasks: TaskWithResponses[]): TaskWithResponses[] {
    return tasks.filter((task) => {
        const responses = task.responses || [];
        return responses.some((r) => r.status === 'submitted');
    });
}

/**
 * Get tasks that have been recently graded (have graded responses).
 */
export function getRecentlyGradedTasks(
    tasks: TaskWithResponses[],
    limit = 5
): Array<{
    task: TaskWithResponses;
    grade: { numericValue: number; displayValue: string };
    gradedAt: number;
}> {
    const result: Array<{
        task: TaskWithResponses;
        grade: { numericValue: number; displayValue: string };
        gradedAt: number;
    }> = [];

    for (const task of tasks) {
        const responses = task.responses || [];
        const gradedResponse = responses
            .filter((r) => r.status === 'graded')
            .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))[0];

        if (!gradedResponse?.grades?.length) continue;

        const grade = gradedResponse.grades[0];
        result.push({
            task,
            grade: { numericValue: grade.numericValue, displayValue: grade.displayValue },
            gradedAt: gradedResponse.submittedAt || 0,
        });
    }

    return result
        .sort((a, b) => b.gradedAt - a.gradedAt)
        .slice(0, limit);
}
