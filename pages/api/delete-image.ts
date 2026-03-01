// pages/api/delete-image.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getDeviceAuthContextFromNextApiRequest } from '@/lib/device-auth-server';

const uploadDir = path.join(process.cwd(), 'public', 'uploads');
const ALLOWED_FILENAME = /^[A-Za-z0-9._-]+$/;

function isSafeUploadFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= 255 &&
    ALLOWED_FILENAME.test(filename) &&
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\')
  );
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  if (!getDeviceAuthContextFromNextApiRequest(req).authorized) {
    res.status(401).json({ message: 'Unauthorized device' });
    return;
  }

  const { urls } = req.body ?? {};
  if (!urls || typeof urls !== 'object') {
    res.status(400).json({ message: 'No URLs provided' });
    return;
  }

  const sizes = [64, 320, 1200] as const;
  const deletePromises = sizes.map(async (size) => {
    const rawFilename = urls[size];
    if (typeof rawFilename !== 'string' || !isSafeUploadFilename(rawFilename)) {
      return;
    }

    const filepath = path.resolve(uploadDir, path.basename(rawFilename));
    if (!filepath.startsWith(`${uploadDir}${path.sep}`)) {
      return;
    }

    try {
      await fs.promises.unlink(filepath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.error('Error deleting file:', err);
      }
    }
  });

  Promise.allSettled(deletePromises)
    .then(() => {
      res.status(200).json({ message: 'Files deleted' });
    })
    .catch(() => {
      res.status(500).json({ message: 'Error deleting files' });
    });
}
