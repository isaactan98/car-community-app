import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Runs: undefined;
  CreateRun: undefined;
  RunDetail: { runId: string };
  LiveMap: { runId: string };
  Profile: undefined;
  /** RSVP car picker, presented as a native sheet. */
  CarPicker: { runId: string; currentCar: string | null };
};

export type ScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
