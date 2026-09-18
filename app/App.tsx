import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
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
import { Loading } from "./src/ui/components";
import { schemeHex, useScheme } from "./src/ui/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();
const ios = Platform.OS === "ios";

function Root() {
  const { ready, token } = useSession();
  const hex = schemeHex(useScheme());
  if (!ready) return <Loading />;
  if (!token) return <InviteScreen />;

  // iOS: transparent system bars with content scrolling beneath, so iOS 26
  // applies Liquid Glass and the scroll-edge effect; bar controls stay
  // monochrome (HIG › Toolbars). Every screen's scroll view therefore uses
  // contentInsetAdjustmentBehavior="automatic".
  const screenOptions: NativeStackNavigationOptions = ios
    ? {
        headerTransparent: true,
        headerTintColor: hex.label,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        contentStyle: { backgroundColor: hex.background },
      }
    : {
        headerStyle: { backgroundColor: hex.background },
        headerTintColor: hex.label,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: hex.background },
      };

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Runs"
        component={RunListScreen}
        options={{ title: "Runs", headerLargeTitle: true }}
      />
      <Stack.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ title: "" }}
      />
      <Stack.Screen
        name="LiveMap"
        component={LiveMapScreen}
        options={
          ios ? { title: "" } : { title: "Live Map" }
        }
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "Profile" }}
      />
      <Stack.Screen
        name="CreateRun"
        component={CreateRunScreen}
        options={{ title: "New Run", presentation: "modal" }}
      />
      <Stack.Screen
        name="CarPicker"
        component={CarPickerScreen}
        options={{
          presentation: "formSheet",
          headerShown: false,
          sheetAllowedDetents: [0.6, 1],
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
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
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
      <StatusBar style="auto" />
      <Root />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemedApp />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
