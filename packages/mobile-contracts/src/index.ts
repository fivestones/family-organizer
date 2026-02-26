export type MobileDevicePlatform = 'ios';

export interface MobileDeviceActivateRequest {
    accessKey: string;
    platform: MobileDevicePlatform;
    deviceName?: string;
    appVersion?: string;
}

export interface MobileDeviceActivateResponse {
    deviceSessionToken: string;
    expiresAt: string;
    sessionId: string;
}

export interface MobileInstantTokenResponse {
    token: string;
    expiresAt?: string;
    principalType: 'kid' | 'parent';
}

export interface MobileFilesListItem {
    key: string;
    size: number;
    lastModified?: string;
    contentType?: string;
}

export interface MobileFilesListResponse {
    files: MobileFilesListItem[];
}

export type MobilePresignScope = 'task-attachment' | 'file-manager' | 'profile-photo';

export interface MobilePresignRequest {
    filename: string;
    contentType: string;
    scope: MobilePresignScope;
}

export interface MobilePresignResponse {
    uploadUrl: string;
    fields?: Record<string, string>;
    method: 'POST' | 'PUT';
    objectKey: string;
    accessUrl: string;
}

