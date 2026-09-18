/**
 * Appearance preference: Night (default), Day, or follow the system.
 *
 * Runs defaults to Night regardless of the OS setting — this app is used in
 * a car, usually after dark, and a screen that flashes white at 11pm on the
 * highway is a safety problem, not a taste one. The preference is persisted
 * so the choice survives a restart, and reads are fail-soft: a corrupt or
 * missing entry falls back to Night rather than throwing.
 *
 * theme.ts reads the resolved scheme from here, so this module must not
 * import from theme.ts (it would close the cycle).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";

const KEY_MODE = "runs.appearance";

/** What the user picked. "system" follows the OS. */
export type AppearanceMode = "night" | "day" | "system";

/** What we actually render. */
export type Scheme = "night" | "day";

function isMode(value: string | null): value is AppearanceMode {
  return value === "night" || value === "day" || value === "system";
}

interface AppearanceValue {
  mode: AppearanceMode;
  scheme: Scheme;
  setMode: (mode: AppearanceMode) => void;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>("night");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY_MODE)
      .then((stored) => {
        if (!cancelled && isMode(stored)) setModeState(stored);
      })
      .catch(() => {
        // Missing or unreadable — Night is already the default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: AppearanceMode) => {
    setModeState(next);
    AsyncStorage.setItem(KEY_MODE, next).catch(() => {
      // Best-effort: the choice still applies for this launch.
    });
  }, []);

  const scheme: Scheme =
    mode === "system" ? (system === "light" ? "day" : "night") : mode;

  /**
   * Push the choice down to the native layer too. Action sheets, date
   * pickers, the form sheet and the keyboard are drawn by the OS and would
   * otherwise follow the *system* appearance — so a phone in light mode with
   * the app in Night would flash a white action sheet mid-run. "unspecified"
   * hands control back to the OS. (iOS 13+ / Android 10+, which is already
   * the floor for background location.)
   */
  useEffect(() => {
    Appearance.setColorScheme(
      mode === "system" ? "unspecified" : mode === "night" ? "dark" : "light",
    );
  }, [mode]);

  const value = useMemo(
    () => ({ mode, scheme, setMode }),
    [mode, scheme, setMode],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

/**
 * The resolved scheme. Falls back to Night outside a provider so a stray
 * render (or a test) never crashes on a missing context.
 */
export function useAppearanceScheme(): Scheme {
  return useContext(AppearanceContext)?.scheme ?? "night";
}

/** Full control, for the appearance picker on the You screen. */
export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside <AppearanceProvider>");
  }
  return value;
}

export const APPEARANCE_OPTIONS: { key: AppearanceMode; label: string }[] = [
  { key: "night", label: "Night" },
  { key: "day", label: "Day" },
  { key: "system", label: "System" },
];
