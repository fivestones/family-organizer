import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash } from 'crypto';
import { DeviceActivationForm } from '@/components/auth/DeviceActivationForm';
import { DEVICE_AUTH_COOKIE_NAME } from '@/lib/device-auth';

export const dynamic = 'force-dynamic';

type ActivatePageProps = {
    searchParams?: Promise<{ key?: string }>;
};

export default async function ActivatePage({ searchParams }: ActivatePageProps) {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(DEVICE_AUTH_COOKIE_NAME)?.value;
    const secretKey = process.env.DEVICE_ACCESS_KEY;
    if (secretKey && cookieValue === createHash('sha256').update(secretKey).digest('hex')) {
        redirect('/');
    }

    const params = searchParams ? await searchParams : undefined;
    return <DeviceActivationForm initialKey={params?.key || ''} />;
}
