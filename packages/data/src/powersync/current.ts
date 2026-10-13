import type { Device } from './device';

// The signed-in person's database, for the areas that are written directly on PowerSync. The app's frame sets it
// before it mounts anything that reads, and mounts everything afresh when the person changes, so a hook or a
// mutation may ask for it whenever it runs.

let current: Device | null = null;

export function setCurrentDevice(device: Device | null): void {
    current = device;
}

export function currentDevice(): Device {
    if (!current) throw new Error('Nobody is signed in on this device yet, so there is no database to read.');
    return current;
}
