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
import { View } from "react-native";
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
import { Loading } from "./src/ui/components";
import { useAppFonts } from "./src/ui/fonts";
import { LiveDock } from "./src/ui/LiveDock";
import { font, schemeHex, useScheme } from "./src/ui/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Routes where the dock must not appear: the map is what it links to, and a
 * floating bar over a modal sheet reads as a bug.
 */
const DOCK_HIDDEN_ROUTES = new Set(["LiveMap", "CreateRun", "CarPicker"]);

function Navigator() {
  const hex = schemeHex(useScheme());

  const screenOptions: NativeStackNavigationOptions = {
    headerStyle: { backgroundColor: hex.background },
    headerTintColor: hex.label,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: font.displayBold, fontSize: 17 },
    contentStyle: { backgroundColor: hex.background },
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
        options={{ headerShown: false }}
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
        onReady={() => setRouteName(navRef.getCurrentRoute()?.name)}
        onStateChange={() => setRouteName(navRef.getCurrentRoute()?.name)}
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
        {signedIn ? <Navigator /> : <InviteScreen />}
      </NavigationContainer>

      {signedIn ? (
        <LiveDock
          selfId={member.id}
          hidden={routeName !== undefined && DOCK_HIDDEN_ROUTES.has(routeName)}
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
