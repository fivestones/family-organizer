import { useEffect, useState } from 'react';
import { getPresignedFileUrl } from '../lib/api-client';

/**
 * Hook that resolves a file key to a presigned S3 URL via the mobile API.
 * Returns null while loading or on error. Caches per fileKey for the
 * lifetime of the component.
 */
export function usePresignedUrl(fileKey) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!fileKey) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    getPresignedFileUrl(fileKey)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => { cancelled = true; };
  }, [fileKey]);

  return url;
}
