import React from 'react';
import { Image } from 'react-native';
import { usePresignedUrl } from '../hooks/usePresignedUrl';
import { getPhotoKey } from '../lib/photo-urls';

export function AvatarPhotoImage({
  photoUrls,
  preferredSize = '320',
  style,
  fallback = null,
  testID,
  resizeMode = 'cover',
}) {
  const fileKey = getPhotoKey(photoUrls, preferredSize);
  const uri = usePresignedUrl(fileKey);

  if (!uri) return fallback;

  return <Image testID={testID} source={{ uri }} style={style} resizeMode={resizeMode} />;
}
