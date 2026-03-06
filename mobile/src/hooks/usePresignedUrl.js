import { useEffect, useState } from 'react';
import { getPresignedFileUrl } from '../lib/api-client';

/**
 * Hook that resolves a file key to a presigned S3 URL via the mobile API.
 * Returns null while loading or on error.
 * Uses a short-lived in-memory cache to avoid duplicate requests.
 */
const CACHE_TTL_MS = 55 * 60 * 1000;
const urlCache = new Map();
const inflightRequests = new Map();

function getCachedUrl(fileKey) {
  const cached = urlCache.get(fileKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    urlCache.delete(fileKey);
    return null;
  }
  return cached.url;
}

export function usePresignedUrl(fileKey) {
  const [url, setUrl] = useState(() => (fileKey ? getCachedUrl(fileKey) : null));

  useEffect(() => {
    if (!fileKey) {
      setUrl(null);
      return;
    }

    const cached = getCachedUrl(fileKey);
    if (cached) {
      setUrl(cached);
      return;
    }

    let cancelled = false;
    const existingRequest = inflightRequests.get(fileKey);
    const request =
      existingRequest ||
      getPresignedFileUrl(fileKey).finally(() => {
        inflightRequests.delete(fileKey);
      });
    inflightRequests.set(fileKey, request);

    request
      .then((resolved) => {
        if (typeof resolved === 'string' && resolved) {
          urlCache.set(fileKey, { url: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
          if (!cancelled) setUrl(resolved);
          return;
        }
        if (!cancelled) setUrl(null);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => { cancelled = true; };
  }, [fileKey]);

  return url;
}
