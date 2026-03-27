'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { ConfigField, DashboardWidgetRecord, FreeformWidgetMeta } from '@/lib/freeform-dashboard/types';
import { getPhotoUrl } from '@/lib/photo-urls';

interface FreeformWidgetSettingsDialogProps {
    widget: DashboardWidgetRecord;
    meta: FreeformWidgetMeta;
    familyMembers: { id: string; name: string; photoUrls?: Record<string, string> | null }[];
    onSave: (widgetId: string, config: Record<string, unknown>) => void;
    onClose: () => void;
}

export default function FreeformWidgetSettingsDialog({
    widget,
    meta,
    familyMembers,
    onSave,
    onClose,
}: FreeformWidgetSettingsDialogProps) {
    const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(widget.config ?? {}) }));

    const fields = meta.configFields ?? [];

    const handleSave = () => {
        onSave(widget.id, draft);
        onClose();
    };

    const renderField = (field: ConfigField) => {
        const value = draft[field.key];

        switch (field.type) {
            case 'boolean':
                return (
                    <label key={field.key} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-sm font-medium text-slate-700">{field.label}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(value)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                                value ? 'bg-blue-600' : 'bg-slate-200'
                            }`}
                            onClick={() => setDraft((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    value ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </label>
                );

            case 'number':
                return (
                    <label key={field.key} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-sm font-medium text-slate-700">{field.label}</span>
                        <input
                            type="number"
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
                            value={typeof value === 'number' ? value : ''}
                            min={field.min}
                            max={field.max}
                            onChange={(e) => {
                                const num = parseInt(e.target.value, 10);
                                setDraft((prev) => ({ ...prev, [field.key]: Number.isFinite(num) ? num : undefined }));
                            }}
                        />
                    </label>
                );

            case 'string':
                return (
                    <label key={field.key} className="flex flex-col gap-1 py-2">
                        <span className="text-sm font-medium text-slate-700">{field.label}</span>
                        <input
                            type="text"
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        />
                    </label>
                );

            case 'family-member':
                return (
                    <div key={field.key} className="py-2">
                        <span className="mb-2 block text-sm font-medium text-slate-700">{field.label}</span>
                        <div className="grid grid-cols-3 gap-2">
                            {familyMembers.map((member) => {
                                const selected = value === member.id;
                                const photoUrl = getPhotoUrl(member.photoUrls, '64');
                                return (
                                    <button
                                        key={member.id}
                                        className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors ${
                                            selected
                                                ? 'border-blue-400 bg-blue-50'
                                                : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                                        }`}
                                        onClick={() => setDraft((prev) => ({ ...prev, [field.key]: member.id }))}
                                    >
                                        {photoUrl ? (
                                            <img
                                                src={photoUrl}
                                                alt={member.name}
                                                className="h-8 w-8 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
                                                {member.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <span className="text-xs font-medium text-slate-700">{member.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );

            case 'family-members':
                return (
                    <div key={field.key} className="py-2">
                        <span className="mb-2 block text-sm font-medium text-slate-700">{field.label}</span>
                        <div className="grid grid-cols-3 gap-2">
                            {familyMembers.map((member) => {
                                const selectedIds = Array.isArray(value) ? (value as string[]) : [];
                                const selected = selectedIds.includes(member.id);
                                const photoUrl = getPhotoUrl(member.photoUrls, '64');
                                return (
                                    <button
                                        key={member.id}
                                        className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors ${
                                            selected
                                                ? 'border-blue-400 bg-blue-50'
                                                : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                                        }`}
                                        onClick={() => {
                                            setDraft((prev) => {
                                                const prevIds = Array.isArray(prev[field.key]) ? (prev[field.key] as string[]) : [];
                                                const next = selected
                                                    ? prevIds.filter((id) => id !== member.id)
                                                    : [...prevIds, member.id];
                                                return { ...prev, [field.key]: next };
                                            });
                                        }}
                                    >
                                        {photoUrl ? (
                                            <img
                                                src={photoUrl}
                                                alt={member.name}
                                                className={`h-8 w-8 rounded-full object-cover ${selected ? '' : 'opacity-40'}`}
                                            />
                                        ) : (
                                            <div
                                                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                                                    selected ? 'bg-blue-200 text-blue-700' : 'bg-slate-200 text-slate-600 opacity-40'
                                                }`}
                                            >
                                                {member.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <span className="text-xs font-medium text-slate-700">{member.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {(!Array.isArray(value) || (value as string[]).length === 0) && (
                            <p className="mt-1.5 text-xs text-slate-400">None selected — showing all members</p>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-slate-900">{meta.label} Settings</h2>
                    <button
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={onClose}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="divide-y divide-slate-100">
                    {fields.map(renderField)}
                </div>

                {fields.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-400">No configurable settings for this widget.</p>
                )}

                <div className="mt-6 flex justify-end gap-2">
                    <button
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        onClick={handleSave}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
