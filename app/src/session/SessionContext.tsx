/**
 * Invite-code session (hard constraint 3: invite-code auth only).
 * Token + member persisted in AsyncStorage; no other auth of any kind.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { joinGroup, setAuthToken, setUnauthorizedHandler } from "../api/client";
import type { Member } from "../api/types";
import { stopLiveSession } from "../live/liveSession";
import {
  clearSession,
  loadMember,
  loadToken,
  saveSession,
} from "../storage/storage";

interface SessionValue {
  ready: boolean;
  token: string | null;
  member: Member | null;
  /** Why the user was signed out, shown on the invite screen. */
  signedOutReason: string | null;
  join: (inviteCode: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedToken, storedMember] = await Promise.all([
        loadToken(),
        loadMember(),
      ]);
      if (cancelled) return;
      if (storedToken && storedMember) {
        setAuthToken(storedToken);
        setToken(storedToken);
        setMember(storedMember);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const join = useCallback(async (inviteCode: string, displayName: string) => {
    const res = await joinGroup(inviteCode.trim(), displayName.trim());
    setAuthToken(res.token);
    await saveSession(res.token, res.member);
    setSignedOutReason(null);
    setToken(res.token);
    setMember(res.member);
  }, []);

  const logout = useCallback(async () => {
    await stopLiveSession(); // privacy: never keep sharing past a session
    setAuthToken(null);
    await clearSession();
    setToken(null);
    setMember(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSignedOutReason(
        "Your sign-in is no longer valid on the server. Join again with an invite code.",
      );
      void logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = useMemo(
    () => ({ ready, token, member, signedOutReason, join, logout }),
    [ready, token, member, signedOutReason, join, logout],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
