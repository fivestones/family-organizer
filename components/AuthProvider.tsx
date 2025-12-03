// components/AuthProvider.tsx
'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import db from '@/lib/db';

// Define the shape of our User context
interface FamilyMemberUser {
    id: string;
    name: string;
    role?: 'parent' | 'child' | string;
    photoUrls?: any;
}

interface AuthContextType {
    currentUser: FamilyMemberUser | null;
    login: (user: FamilyMemberUser) => void;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STORAGE_KEY = 'family_organizer_user_id';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<FamilyMemberUser | null>(null);

    // Fetch family members to resolve ID to actual user object
    const { data } = db.useQuery({ familyMembers: {} });

    // 1. Initialize from LocalStorage
    useEffect(() => {
        const storedId = localStorage.getItem(STORAGE_KEY);
        if (storedId) {
            setCurrentUserId(storedId);
        }

        // Listen for changes in other tabs to sync login state immediately
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) {
                // e.newValue will be the new ID on login, or null on logout
                setCurrentUserId(e.newValue);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // 2. Sync currentUserId with actual FamilyMember data
    useEffect(() => {
        if (currentUserId && data?.familyMembers) {
            const foundMember = data.familyMembers.find((m: any) => m.id === currentUserId);
            if (foundMember) {
                setCurrentUser({
                    id: foundMember.id,
                    name: foundMember.name,
                    role: foundMember.role,
                    photoUrls: foundMember.photoUrls,
                });
            } else {
                // ID exists in storage but not in DB (maybe deleted?), clear it
                logout();
            }
        } else if (!currentUserId) {
            setCurrentUser(null);
        }
    }, [currentUserId, data]);

    const login = useCallback((user: FamilyMemberUser) => {
        localStorage.setItem(STORAGE_KEY, user.id);
        setCurrentUserId(user.id);
        setCurrentUser(user);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setCurrentUserId(null);
        setCurrentUser(null);
    }, []);

    // 3. Auto-Logout on Idle
    useEffect(() => {
        if (!currentUser) return;

        let timeoutId: NodeJS.Timeout;

        const resetTimer = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                console.log('Auto-logging out due to inactivity.');
                logout();
            }, IDLE_TIMEOUT_MS);
        };

        // Events to listen for activity
        window.addEventListener('mousemove', resetTimer);
        window.addEventListener('keydown', resetTimer);
        window.addEventListener('click', resetTimer);
        window.addEventListener('touchstart', resetTimer);

        // Start initial timer
        resetTimer();

        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('mousemove', resetTimer);
            window.removeEventListener('keydown', resetTimer);
            window.removeEventListener('click', resetTimer);
            window.removeEventListener('touchstart', resetTimer);
        };
    }, [currentUser, logout]);

    return <AuthContext.Provider value={{ currentUser, login, logout, isAuthenticated: !!currentUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
