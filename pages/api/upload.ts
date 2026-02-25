import formidable from 'formidable';
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { DEVICE_AUTH_COOKIE_NAME, hasValidDeviceAuthCookie } from '@/lib/device-auth';

export const config = {
  api: {
    bodyParser: false, // Disable body parsing so we can use formidable
  },
};

const uploadDir = path.join(process.cwd(), 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  if (!hasValidDeviceAuthCookie(req.cookies?.[DEVICE_AUTH_COOKIE_NAME])) {
    res.status(401).json({ message: 'Unauthorized device' });
    return;
  }

  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: MAX_UPLOAD_SIZE_BYTES,
    maxFiles: 1,
  });

  form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Error parsing files:', err);
        return res.status(400).json({ message: 'Error parsing files' });
      }

      const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!uploadedFile) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      if (!uploadedFile.mimetype || !ALLOWED_MIME_TYPES.has(uploadedFile.mimetype)) {
        try {
          await fs.promises.unlink(uploadedFile.filepath);
        } catch {}
        return res.status(400).json({ message: 'Unsupported file type' });
      }

      const baseFilename = `${Date.now()}_${randomUUID()}_cropped_image`;

      try {
        // Generate resized images
        const filepath1200 = path.join(uploadDir, `${baseFilename}_1200.png`);
        const filepath320 = path.join(uploadDir, `${baseFilename}_320.png`);
        const filepath64 = path.join(uploadDir, `${baseFilename}_64.png`);

        await sharp(uploadedFile.filepath).resize({ width: 1200, height: 1200, fit: 'inside' }).toFile(filepath1200);
        await sharp(uploadedFile.filepath).resize(320, 320).toFile(filepath320);
        await sharp(uploadedFile.filepath).resize(64, 64).toFile(filepath64);

        // Delete the original uploaded file
        fs.unlinkSync(uploadedFile.filepath);

        // Return the filenames in the JSON response
        res.status(200).json({
          photoUrls: {
            64: `${baseFilename}_64.png`,
            320: `${baseFilename}_320.png`,
            1200: `${baseFilename}_1200.png`,
          },
        });
      } catch (error) {
        console.error('Error processing images:', error);
        res.status(500).json({ message: 'Error processing images' });
      }
  });
}
