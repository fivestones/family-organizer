// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    id: vi.fn(() => 'evt-new'),
    dbTransact: vi.fn(),
    txOps: [] as any[],
}));

vi.mock('@instantdb/react', () => ({
    id: mocks.id,
    tx: {
        calendarItems: new Proxy(
            {},
            {
                get(_target, key) {
                    return {
                        update(data: any) {
                            const op = { entity: 'calendarItems', id: String(key), action: 'update', data };
                            mocks.txOps.push(op);
                            return op;
                        },
                    };
                },
            }
        ),
    },
}));

vi.mock('@/lib/db', () => ({
    db: {
        transact: mocks.dbTransact,
    },
}));

vi.mock('@/components/ui/switch', () => ({
    Switch: ({ id, checked, onCheckedChange }: any) => (
        <input
            id={id}
            type="checkbox"
            checked={Boolean(checked)}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
        />
    ),
}));

import AddEventForm from '@/components/AddEvent';

function renderForm(props?: Partial<React.ComponentProps<typeof AddEventForm>>) {
    const onClose = vi.fn();
    render(
        <AddEventForm
            selectedDate={new Date(2026, 2, 15)}
            selectedEvent={null}
            onClose={onClose}
            defaultStartTime="09:00"
            {...props}
        />
    );
    return { onClose };
}

function getSingleOp() {
    expect(mocks.dbTransact).toHaveBeenCalledTimes(1);
    const [ops] = mocks.dbTransact.mock.calls[0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(1);
    return ops[0];
}

describe('AddEventForm', () => {
    beforeEach(() => {
        mocks.id.mockReset();
        mocks.id.mockReturnValue('evt-new');
        mocks.dbTransact.mockReset();
        mocks.txOps.length = 0;
    });

    it('creates an all-day event with exclusive end date and calendar index fields', async () => {
        const { onClose } = renderForm();
        const user = userEvent.setup();

        await user.type(screen.getByLabelText('Title'), 'Family Dinner');
        await user.click(screen.getByRole('button', { name: /add event/i }));

        const op = getSingleOp();
        expect(op).toMatchObject({
            entity: 'calendarItems',
            id: 'evt-new',
            action: 'update',
            data: expect.objectContaining({
                title: 'Family Dinner',
                isAllDay: true,
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                year: 2026,
                month: 3,
                dayOfMonth: 15,
            }),
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('switches to timed mode and keeps event duration when the start time changes', async () => {
        renderForm();
        const user = userEvent.setup();

        await user.click(screen.getByLabelText('All-day event'));

        const startTime = screen.getByLabelText('Start Time') as HTMLInputElement;
        const endTime = screen.getByLabelText('End Time') as HTMLInputElement;
        expect(startTime.value).toBe('09:00');
        expect(endTime.value).toBe('10:00');

        fireEvent.change(startTime, { target: { value: '11:30' } });

        expect((screen.getByLabelText('Start Time') as HTMLInputElement).value).toBe('11:30');
        expect((screen.getByLabelText('End Time') as HTMLInputElement).value).toBe('12:30');
    });

    it('populates fields for an existing timed event and updates that event on submit', async () => {
        const { onClose } = renderForm({
            selectedDate: null,
            selectedEvent: {
                id: 'evt-123',
                title: 'Soccer Practice',
                description: 'Bring water',
                startDate: '2026-03-15T14:30:00',
                endDate: '2026-03-15T15:30:00',
                isAllDay: false,
            } as any,
        });
        const user = userEvent.setup();

        expect(screen.getByLabelText('Title')).toHaveValue('Soccer Practice');
        expect(screen.getByLabelText('Description')).toHaveValue('Bring water');
        expect(screen.getByLabelText('Start Date')).toHaveValue('2026-03-15');
        expect(screen.getByLabelText('Start Time')).toHaveValue('14:30');
        expect(screen.getByLabelText('End Time')).toHaveValue('15:30');

        await user.clear(screen.getByLabelText('Title'));
        await user.type(screen.getByLabelText('Title'), 'Soccer Practice (Updated)');
        await user.click(screen.getByRole('button', { name: /update event/i }));

        const op = getSingleOp();
        expect(op.id).toBe('evt-123');
        expect(op.data).toEqual(
            expect.objectContaining({
                title: 'Soccer Practice (Updated)',
                description: 'Bring water',
                isAllDay: false,
                year: 2026,
                month: 3,
                dayOfMonth: 15,
            })
        );
        expect(typeof op.data.startDate).toBe('string');
        expect(typeof op.data.endDate).toBe('string');
        expect(Date.parse(op.data.endDate) - Date.parse(op.data.startDate)).toBe(60 * 60 * 1000);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
