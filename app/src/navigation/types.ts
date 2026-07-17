import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Runs: undefined;
  CreateRun: undefined;
  RunDetail: { runId: string };
  LiveMap: { runId: string };
  Garage: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
