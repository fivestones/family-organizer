// pages/api/delete-image.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { urls } = req.body;
    if (urls) {
      const sizes = [64, 320, 1200];
      sizes.forEach((size) => {
        const filename = urls[size];
        if (filename) {
          const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
          fs.unlink(filepath, (err) => {
            if (err) {
              console.error('Error deleting file:', err);
              // Do not return, try to delete all files
            }
          });
        }
      });
      res.status(200).json({ message: 'Files deleted' });
    } else {
      res.status(400).json({ message: 'No URLs provided' });
    }
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}