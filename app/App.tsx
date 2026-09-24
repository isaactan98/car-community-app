import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Importing the live session registers the background location task with
// TaskManager at JS startup — required for the Android foreground service.
import "./src/live/liveSession";

import type { RootStackParamList } from "./src/navigation/types";
import CarPickerScreen from "./src/screens/CarPickerScreen";
import CreateRunScreen from "./src/screens/CreateRunScreen";
import InviteScreen from "./src/screens/InviteScreen";
import LiveMapScreen from "./src/screens/LiveMapScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import RunDetailScreen from "./src/screens/RunDetailScreen";
import RunListScreen from "./src/screens/RunListScreen";
import { SessionProvider, useSession } from "./src/session/SessionContext";
import { AppearanceProvider } from "./src/ui/appearance";
import { FadeIn, Loading } from "./src/ui/components";
import { useAppFonts } from "./src/ui/fonts";
import { LiveDock } from "./src/ui/LiveDock";
import { font, schemeHex, useScheme } from "./src/ui/theme";
import { useReduceMotion } from "./src/ui/useReduceMotion";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Routes where the dock must not appear: the map is what it links to, and a
 * floating bar over a modal sheet reads as a bug.
 */
const DOCK_HIDDEN_ROUTES = new Set(["LiveMap", "CreateRun", "CarPicker"]);

/**
 * How screens move, by what they are:
 * - Pushes (run detail, profile) keep the platform's own slide — on iOS that
 *   is the only one that carries the parallax and the interactive swipe back
 *   — and take the swipe from anywhere on the screen, not just the edge.
 *   Android gets the same iOS-style slide so both read as one app.
 * - The live map rises into place: it's where the drive happens, not another
 *   page beside the list.
 * - Modal and sheet presentations keep their native motion.
 * Under Reduce Motion everything becomes a short crossfade.
 */
function Navigator() {
  const hex = schemeHex(useScheme());
  const reduce = useReduceMotion();

  const screenOptions: NativeStackNavigationOptions = {
    headerStyle: { backgroundColor: hex.background },
    headerTintColor: hex.label,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: font.displayBold, fontSize: 17 },
    contentStyle: { backgroundColor: hex.background },
    ...(reduce
      ? { animation: "fade", animationDuration: 200 }
      : {
          animation: Platform.OS === "android" ? "ios_from_right" : "default",
          fullScreenGestureEnabled: true,
        }),
  };

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {/* The list draws its own hero, so the bar stays empty and the title
          never competes with it. */}
      <Stack.Screen
        name="Runs"
        component={RunListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="RunDetail" component={RunDetailScreen} options={{ title: "" }} />
      <Stack.Screen
        name="LiveMap"
        component={LiveMapScreen}
        options={{
          headerShown: false,
          // A full-screen swipe would fight the map's own panning.
          fullScreenGestureEnabled: false,
          ...(reduce ? null : { animation: "fade_from_bottom", animationDuration: 380 }),
        }}
      />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "" }} />
      <Stack.Screen
        name="CreateRun"
        component={CreateRunScreen}
        options={{ title: "", presentation: "modal", headerShown: false }}
      />
      <Stack.Screen
        name="CarPicker"
        component={CarPickerScreen}
        options={{
          presentation: "formSheet",
          headerShown: false,
          sheetAllowedDetents: [0.65, 1],
          sheetGrabberVisible: true,
          contentStyle: { backgroundColor: hex.background },
        }}
      />
    </Stack.Navigator>
  );
}

function ThemedApp() {
  const scheme = useScheme();
  const hex = schemeHex(scheme);
  const { ready, token, member } = useSession();
  const fontsReady = useAppFonts();
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  // The run the current screen is about, so the dock can step aside on that
  // run's own detail screen, which already says everything the dock does.
  const [routeRunId, setRouteRunId] = useState<string | undefined>(undefined);
  const trackRoute = () => {
    const current = navRef.getCurrentRoute();
    setRouteName(current?.name);
    const params = current?.params as { runId?: unknown } | undefined;
    setRouteRunId(typeof params?.runId === "string" ? params.runId : undefined);
  };

  // Hold the app until fonts resolve. useAppFonts() also resolves on failure,
  // so a missing font degrades to the system face instead of a dead splash.
  if (!ready || !fontsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: hex.background }}>
        <Loading />
      </View>
    );
  }

  const base = scheme === "night" ? DarkTheme : DefaultTheme;
  const signedIn = !!token && !!member;

  return (
    <View style={{ flex: 1, backgroundColor: hex.background }}>
      <StatusBar style={scheme === "night" ? "light" : "dark"} />
      <NavigationContainer
        ref={navRef}
        onReady={trackRoute}
        onStateChange={trackRoute}
        theme={{
          ...base,
          colors: {
            ...base.colors,
            primary: hex.tint,
            background: hex.background,
            card: hex.surface,
            text: hex.label,
            border: hex.separator,
          },
        }}
      >
        {/* Keyed so joining the group crossfades into the app (and leaving
            it fades back to the invite) instead of snapping. */}
        <FadeIn key={signedIn ? "app" : "invite"} style={{ flex: 1 }}>
          {signedIn ? <Navigator /> : <InviteScreen />}
        </FadeIn>
      </NavigationContainer>

      {signedIn ? (
        <LiveDock
          selfId={member.id}
          hidden={routeName !== undefined && DOCK_HIDDEN_ROUTES.has(routeName)}
          hiddenForRunId={routeName === "RunDetail" ? routeRunId : undefined}
          onOpen={(runId) => navRef.navigate("LiveMap", { runId })}
        />
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppearanceProvider>
        <SessionProvider>
          <ThemedApp />
        </SessionProvider>
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}
