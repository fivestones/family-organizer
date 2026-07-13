export function isTimeMachineEnabled(
    env: Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'NEXT_PUBLIC_ENABLE_TIME_MACHINE'>> = process.env
): boolean {
    return env.NODE_ENV !== 'production' || env.NEXT_PUBLIC_ENABLE_TIME_MACHINE === 'true';
}
