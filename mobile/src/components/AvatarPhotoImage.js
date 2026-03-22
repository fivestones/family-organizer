import React from 'react';
import { Image as ExpoImage } from 'expo-image';
import { useCachedFileUri } from '../hooks/useCachedFileUri';
import { prefetchCachedFileUris } from '../lib/file-cache';
import { getPhotoKey, getPhotoKeys } from '../lib/photo-urls';

function getContentFit(resizeMode) {
  if (resizeMode === 'contain') return 'contain';
  if (resizeMode === 'stretch') return 'fill';
  return 'cover';
}

export function AvatarPhotoImage({
  photoUrls,
  preferredSize = '320',
  style,
  fallback = null,
  testID,
  resizeMode = 'cover',
}) {
  const fileKey = getPhotoKey(photoUrls, preferredSize);
  const uri = useCachedFileUri(fileKey);

  React.useEffect(() => {
    const variantKeys = getPhotoKeys(photoUrls);
    if (variantKeys.length === 0) return;

    void prefetchCachedFileUris(variantKeys);
  }, [photoUrls]);

  if (!uri) return fallback;

  return (
    <ExpoImage
      testID={testID}
      source={{ uri, cacheKey: fileKey || undefined }}
      style={style}
      contentFit={getContentFit(resizeMode)}
      cachePolicy="disk"
      recyclingKey={fileKey || null}
      transition={120}
    />
  );
}
