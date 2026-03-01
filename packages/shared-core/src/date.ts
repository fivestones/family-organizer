import { RRule } from 'rrule';

export function toUTCDate(date: Date | string | number): Date {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function createRRuleWithStartDate(rruleString: string | null | undefined, startDateString: string | Date): RRule | null {
    if (!rruleString) return null;

    const startDate = toUTCDate(startDateString);
    const cleanRruleString = rruleString.replace(/^RRULE:/, '');

    try {
        const rruleOptions = RRule.parseString(cleanRruleString);
        return new RRule({
            ...rruleOptions,
            dtstart: startDate,
        });
    } catch {
        return null;
    }
}

