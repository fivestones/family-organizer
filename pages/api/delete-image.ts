// pages/api/delete-image.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { url } = req.body;
    if (url) {
      const filename = url.split('/uploads/')[1];
      const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
      fs.unlink(filepath, (err) => {
        if (err) {
          console.error('Error deleting file:', err);
          return res.status(500).json({ message: 'Error deleting file' });
        }
        res.status(200).json({ message: 'File deleted' });
      });
    } else {
      res.status(400).json({ message: 'No URL provided' });
    }
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}