import 'server-only';

import { randomUUID } from 'crypto';
import type { AppDatabase } from './db';

// The content queue as something outside the app drives it: a display asks what is showing, and a scheduled job
// adds an item or moves the queue on. Each of those is asked by an activated device, with nobody signed in.

/** The category asked for does not exist. */
export class NoSuchCategoryError extends Error {
    constructor(slug: string) {
        super(`Category not found: ${slug}`);
    }
}

/** What is showing in a category, with its files. */
export async function currentQueueItem(db: AppDatabase, slug: string) {
    const category = await db.selectFrom('content_categories').select(['id', 'name', 'slug']).where('slug', '=', slug).executeTakeFirst();
    if (!category) throw new NoSuchCategoryError(slug);
    const item = await db.selectFrom('content_queue_items').selectAll().where('category_id', '=', category.id).where('status', '=', 'live').orderBy('live_at', 'desc').executeTakeFirst();
    if (!item) return { category, currentItem: null };
    const attachments = await db.selectFrom('content_attachments').selectAll().where('queue_item_id', '=', item.id).orderBy('created_at').execute();
    return {
        category,
        currentItem: {
            id: item.id,
            title: item.title,
            richTextContent: item.rich_text_content ?? '',
            linkUrl: item.link_url ?? '',
            status: item.status,
            sortOrder: item.sort_order,
            durationMs: item.duration_ms === null ? 0 : Number(item.duration_ms),
            liveAt: item.live_at,
            liveUntil: item.live_until,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
            attachments: attachments.map((file) => ({
                id: file.id,
                name: file.name,
                type: file.type,
                url: file.url,
                kind: file.kind,
                sizeBytes: file.size_bytes === null ? null : Number(file.size_bytes),
                width: file.width,
                height: file.height,
                durationSec: file.duration_sec,
                thumbnailUrl: file.thumbnail_url,
                thumbnailWidth: file.thumbnail_width,
                thumbnailHeight: file.thumbnail_height,
                blurhash: file.blurhash,
            })),
        },
    };
}

export interface NewQueueItem {
    categorySlug: string;
    title: string;
    richTextContent?: string;
    linkUrl?: string;
    durationMs?: number;
}

/** Adds an item to the end of a category's queue. */
export async function addQueueItem(db: AppDatabase, input: NewQueueItem, now: Date = new Date()) {
    return db.transaction().execute(async (trx) => {
        // Holding the category is what makes "the end" one place when two items are added at once.
        const category = await trx.selectFrom('content_categories').select('id').where('slug', '=', input.categorySlug).forUpdate().executeTakeFirst();
        if (!category) throw new NoSuchCategoryError(input.categorySlug);
        const last = await trx.selectFrom('content_queue_items').select((expression) => expression.fn.max('sort_order').as('last')).where('category_id', '=', category.id).executeTakeFirst();
        const sortOrder = Math.max(last?.last ?? 0, 0) + 1;
        const id = randomUUID();
        const duration = typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs > 0 ? Math.round(input.durationMs) : null;
        await trx
            .insertInto('content_queue_items')
            .values({ id, category_id: category.id, title: input.title, rich_text_content: input.richTextContent || null, link_url: input.linkUrl || null, status: 'queued', sort_order: sortOrder, duration_ms: duration, created_at: now, updated_at: now })
            .execute();
        return { id, status: 'queued' as const, sortOrder };
    });
}

/** Moves a category's queue on: what was showing is put away, and the next item waiting is shown. */
export async function advanceQueue(db: AppDatabase, slug: string, now: Date = new Date()) {
    return db.transaction().execute(async (trx) => {
        const category = await trx.selectFrom('content_categories').select(['id', 'default_duration_ms']).where('slug', '=', slug).forUpdate().executeTakeFirst();
        if (!category) throw new NoSuchCategoryError(slug);
        const showing = await trx.updateTable('content_queue_items').set({ status: 'archived', archived_at: now, updated_at: now }).where('category_id', '=', category.id).where('status', '=', 'live').returning('id').execute();
        const next = await trx.selectFrom('content_queue_items').select(['id', 'duration_ms']).where('category_id', '=', category.id).where('status', '=', 'queued').orderBy('sort_order').orderBy('created_at').executeTakeFirst();
        if (next) {
            const duration = Number(next.duration_ms) > 0 ? Number(next.duration_ms) : Number(category.default_duration_ms);
            await trx.updateTable('content_queue_items').set({ status: 'live', live_at: now, live_until: new Date(now.getTime() + duration), updated_at: now }).where('id', '=', next.id).execute();
        }
        return { advanced: true, archivedId: showing[0]?.id ?? null, promotedId: next?.id ?? null };
    });
}
