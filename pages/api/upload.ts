import formidable from 'formidable';
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export const config = {
  api: {
    bodyParser: false, // Disable body parsing so we can use formidable
  },
};

const uploadDir = path.join(process.cwd(), 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const form = formidable({ uploadDir, keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Error parsing files:', err);
        return res.status(400).json({ message: 'Error parsing files' });
      }

      const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!uploadedFile) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const timestamp = Date.now();
      const baseFilename = `${timestamp}_cropped_image`;

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
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}