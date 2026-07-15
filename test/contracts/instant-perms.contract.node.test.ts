import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import rules from '@/instant.perms';

function parseSchemaEntityNames(source: string) {
    return Array.from(source.matchAll(/^\s+([A-Za-z0-9_$]+):\s*i\.entity\(/gm)).map((match) => match[1]).sort();
}

describe('instant.perms contract', () => {
    it('explicitly covers all schema entities plus core permission sections', async () => {
        const schemaSource = await fs.readFile(path.join(process.cwd(), 'instant.schema.ts'), 'utf8');
        const entityNames = parseSchemaEntityNames(schemaSource);
        const topLevelRuleKeys = Object.keys(rules as any);

        expect(topLevelRuleKeys).toEqual(expect.arrayContaining(['$default', '$users', '$files', 'attrs']));
        for (const entityName of entityNames) {
            expect(topLevelRuleKeys, `missing rule for entity ${entityName}`).toContain(entityName);
        }
    });

    it('keeps the deny-by-default + attrs lock-down safety net in place', () => {
        const perms = rules as any;
        expect(perms.$default.allow.view).toContain("auth.ref('$user.type')");
        expect(perms.$default.allow.create).toBe('false');
        expect(perms.$default.allow.update).toBe('false');
        expect(perms.$default.allow.delete).toBe('false');
        expect(perms.attrs.allow.create).toBe('false');
    });

    it('requires trusted createdBy audit stamping for allowance transaction creation', () => {
        const perms = rules as any;
        expect(perms.allowanceTransactions.bind.auditMatchesPrincipal).toBe('data.createdBy == auth.id');
        expect(perms.allowanceTransactions.allow.create).toContain('auditMatchesPrincipal');
        expect(perms.allowanceTransactions.allow.update).toBe('false');
    });

    it('keeps allowance distribution keys unique and indexed for retry safety', async () => {
        const schemaSource = await fs.readFile(path.join(process.cwd(), 'instant.schema.ts'), 'utf8');
        const allowanceTransactions = schemaSource.slice(
            schemaSource.indexOf('allowanceTransactions: i.entity({'),
            schemaSource.indexOf('announcements: i.entity({')
        );

        expect(allowanceTransactions).toContain('distributionKey: i.string().unique().indexed().optional()');
    });

    it('limits kid family-member preferences and PIN hashes to the authenticated member row', () => {
        const perms = rules as any;
        expect(perms.familyMembers.bind.authFamilyMemberIds).toBe("auth.ref('$user.familyMemberId')");
        expect(perms.familyMembers.allow.update).toContain('data.id in authFamilyMemberIds');
        expect(perms.familyMembers.allow.update).toContain('kidSafeFamilyMemberUpdate');
        expect(perms.familyMembers.fields.pinHash).toBe('isParent || data.id in authFamilyMemberIds');
    });

    it('keeps Apple Calendar account credentials parent-only', () => {
        const perms = rules as any;
        expect(perms.calendarSyncAccounts.allow.view).toBe('isParent');
        expect(perms.calendarSyncAccounts.allow.create).toBe('isParent');
        expect(perms.calendarSyncAccounts.allow.update).toBe('isParent');
        expect(perms.calendarSyncAccounts.allow.delete).toBe('isParent');
    });

    it('limits kid completion writes to their own safe fields', () => {
        const perms = rules as any;
        expect(perms.choreCompletions.bind.authFamilyMemberIds).toBe("auth.ref('$user.familyMemberId')");
        expect(perms.choreCompletions.bind.hasAuthFamilyMemberId).toBe(
            "authFamilyMemberIds.exists(memberId, memberId != '')"
        );
        expect(perms.choreCompletions.bind.ownsCompletion).toContain("data.ref('completedBy.id')");
        expect(perms.choreCompletions.allow.create).toContain('hasAuthFamilyMemberId');
        expect(perms.choreCompletions.allow.create).toContain('data.allowanceAwarded == false');
        expect(perms.choreCompletions.allow.update).toContain('kidSafeCompletionUpdate');
        expect(perms.choreCompletions.bind.kidSafeCompletionUpdate).not.toContain('allowanceAwarded');
        expect(perms.choreCompletions.bind.kidSafeCompletionUpdate).not.toContain('dateDue');
        expect(perms.choreCompletions.allow.link.$default).toBe('isFamilyPrincipal');
        expect(perms.familyMembers.allow.link.$default).toBe('isFamilyPrincipal');
        expect(perms.familyMembers.allow.link.completedChores).toContain("data.id in auth.ref('$user.familyMemberId')");
        expect(perms.familyMembers.allow.link.markedCompletions).toContain("data.id in auth.ref('$user.familyMemberId')");
    });

    it('binds immutable kid history events to the authenticated member actor', () => {
        const perms = rules as any;
        expect(perms.historyEvents.bind.authFamilyMemberIds).toBe("auth.ref('$user.familyMemberId')");
        expect(perms.historyEvents.bind.hasAuthFamilyMemberId).toContain('authFamilyMemberIds.exists');
        expect(perms.historyEvents.bind.kidOwnActor).toBe('data.actorFamilyMemberId in authFamilyMemberIds');
        expect(perms.historyEvents.allow.create).toContain('hasAuthFamilyMemberId');
        expect(perms.historyEvents.allow.create).toContain('kidOwnActor');
        expect(perms.historyEvents.allow.link.actor).toContain(
            "data.actorFamilyMemberId in auth.ref('$user.familyMemberId')"
        );
        expect(perms.historyEvents.allow.update).toBe('false');
        expect(perms.historyEvents.allow.delete).toBe('false');
        expect(perms.familyMembers.allow.link.actedHistoryEvents).toContain(
            "data.id in auth.ref('$user.familyMemberId')"
        );
    });

    it('lets family principals link chore completions without opening broader chore writes', () => {
        const perms = rules as any;
        expect(perms.chores.allow.create).toBe('isParent');
        expect(perms.chores.allow.update).toBe('isParent');
        expect(perms.chores.allow.delete).toBe('isParent');
        expect(perms.chores.allow.link.completions).toBe('isFamilyPrincipal');
        expect(perms.chores.allow.link.$default).toBe('isParent');
        expect(perms.chores.allow.unlink.$default).toBe('isParent');
    });

    it('indexes completion due dates for bounded day-view queries', async () => {
        const schemaSource = await fs.readFile(path.join(process.cwd(), 'instant.schema.ts'), 'utf8');
        const entityStart = schemaSource.indexOf('choreCompletions: i.entity({');
        expect(entityStart).toBeGreaterThan(-1);
        expect(schemaSource.slice(entityStart, entityStart + 400)).toContain('dateDue: i.string().indexed()');
    });

    it('cascades task-owned records when their task or response field is deleted', async () => {
        const schemaSource = await fs.readFile(path.join(process.cwd(), 'instant.schema.ts'), 'utf8');

        for (const linkName of ['taskResponseFieldsTask', 'taskResponseFieldValuesField', 'tasksAttachments', 'taskUpdatesTask']) {
            const linkStart = schemaSource.indexOf(`${linkName}: {`);
            expect(linkStart, `missing link ${linkName}`).toBeGreaterThan(-1);
            const linkSource = schemaSource.slice(linkStart, linkStart + 500);
            expect(linkSource, `${linkName} must cascade from its has-one task/field relation`).toContain("onDelete: 'cascade'");
        }
    });

    it('cascades chore-owned completion and rotation-assignment rows', async () => {
        const schemaSource = await fs.readFile(path.join(process.cwd(), 'instant.schema.ts'), 'utf8');

        for (const linkName of ['choresAssignments', 'choresCompletions']) {
            const linkStart = schemaSource.indexOf(`${linkName}: {`);
            expect(linkStart, `missing link ${linkName}`).toBeGreaterThan(-1);
            const linkSource = schemaSource.slice(linkStart, linkStart + 450);
            expect(linkSource, `${linkName} must cascade from its has-one chore relation`).toContain("onDelete: 'cascade'");
        }
    });
});
