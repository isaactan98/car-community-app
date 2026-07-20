import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Importing the live session registers the background location task with
// TaskManager at JS startup — required for the Android foreground service.
import "./src/live/liveSession";

import type { RootStackParamList } from "./src/navigation/types";
import CreateRunScreen from "./src/screens/CreateRunScreen";
import GarageScreen from "./src/screens/GarageScreen";
import InviteScreen from "./src/screens/InviteScreen";
import LiveMapScreen from "./src/screens/LiveMapScreen";
import RunDetailScreen from "./src/screens/RunDetailScreen";
import RunListScreen from "./src/screens/RunListScreen";
import { SessionProvider, useSession } from "./src/session/SessionContext";
import { Loading } from "./src/ui/components";
import { Wordmark } from "./src/ui/Logo";
import { colors } from "./src/ui/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    primary: colors.accent,
    border: colors.border,
  },
};

function Root() {
  const { ready, token } = useSession();
  if (!ready) return <Loading />;
  if (!token) return <InviteScreen />;
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "800" },
      }}
    >
      <Stack.Screen
        name="Runs"
        component={RunListScreen}
        options={{
          title: "Runs",
          headerTitle: () => <Wordmark size={22} />,
        }}
      />
      <Stack.Screen
        name="CreateRun"
        component={CreateRunScreen}
        options={{ title: "New run" }}
      />
      <Stack.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ title: "Arrival board" }}
      />
      <Stack.Screen
        name="LiveMap"
        component={LiveMapScreen}
        options={{ title: "Live map" }}
      />
      <Stack.Screen
        name="Garage"
        component={GarageScreen}
        options={{ title: "Garage" }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="light" />
          <Root />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
