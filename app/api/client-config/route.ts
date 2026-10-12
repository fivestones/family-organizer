import { NextRequest } from 'next/server';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';
import { readClientConfig } from '@/lib/server/installation';
import { jsonError, jsonOk } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

/** Tells an activated device which backend to run on, before anyone is signed in. */
export async function GET(request: NextRequest) {
    if (!getDeviceAuthContextFromNextRequest(request).authorized) return jsonError(401, 'unauthorized_device', 'Unauthorized device');
    return jsonOk(await readClientConfig());
}
