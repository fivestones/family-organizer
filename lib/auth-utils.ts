/**
 * Hashes a PIN using SHA-256 for client-side validation.
 * @param pin - The plain text PIN (numbers).
 * @returns The hex string representation of the hash.
 */
export async function hashPin(pin: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}
