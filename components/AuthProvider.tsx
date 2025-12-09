// components/AuthProvider.tsx
'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import db from '@/lib/db';

// Define the shape of our User context
export interface FamilyMemberUser {
    id: string;
    name: string;
    role?: 'parent' | 'child' | string;
    photoUrls?: any;
}

interface AuthContextType {
    currentUser: FamilyMemberUser | null;
    login: (user: FamilyMemberUser, remember?: boolean) => void;
    logout: () => void;
    isAuthenticated: boolean;
    // +++ CHANGED: Expose loading state to consumers +++
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const STORAGE_KEY = 'family_organizer_user_id';
const REMEMBER_KEY = 'family_organizer_remember_me';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<FamilyMemberUser | null>(null);
    const [rememberMe, setRememberMe] = useState(false);

    // Fetch family members to resolve ID to actual user object
    // +++ CHANGED: Destructure isLoading +++
    const { data, isLoading } = db.useQuery({ familyMembers: {} });

    // 1. Initialize from LocalStorage
    useEffect(() => {
        const storedId = localStorage.getItem(STORAGE_KEY);
        const storedRemember = localStorage.getItem(REMEMBER_KEY);

        if (storedId) {
            setCurrentUserId(storedId);
        }
        if (storedRemember === 'true') {
            setRememberMe(true);
        }

        // Listen for changes in other tabs to sync login state immediately
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) {
                // e.newValue will be the new ID on login, or null on logout
                setCurrentUserId(e.newValue);
            }
            if (e.key === REMEMBER_KEY) {
                setRememberMe(e.newValue === 'true');
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // 2. Sync currentUserId with actual FamilyMember data
    useEffect(() => {
        // +++ CHANGED: Do not attempt to sync or logout while DB is loading +++
        if (isLoading) return;

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
                // logout(); // <--- DISABLED: Prevents logout on HMR/Fast Refresh updates
            }
        } else if (!currentUserId) {
            setCurrentUser(null);
        }
    }, [currentUserId, data, isLoading]); // +++ CHANGED: Added isLoading dependency

    const login = useCallback((user: FamilyMemberUser, remember: boolean = false) => {
        localStorage.setItem(STORAGE_KEY, user.id);

        if (remember) {
            localStorage.setItem(REMEMBER_KEY, 'true');
            setRememberMe(true);
        } else {
            localStorage.removeItem(REMEMBER_KEY);
            setRememberMe(false);
        }

        setCurrentUserId(user.id);
        setCurrentUser(user);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(REMEMBER_KEY); // Clear remember me on manual logout
        setRememberMe(false);
        setCurrentUserId(null);
        setCurrentUser(null);
    }, []);

    // 3. Auto-Logout on Idle
    useEffect(() => {
        if (!currentUser) return;

        // +++ CHECK REMEMBER ME +++
        if (rememberMe) return; // Skip auto-logout if remember me is active

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
    }, [currentUser, logout, rememberMe]);

    return (
        // +++ CHANGED: Pass isLoading to provider +++
        <AuthContext.Provider value={{ currentUser, login, logout, isAuthenticated: !!currentUser, isLoading }}>{children}</AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
