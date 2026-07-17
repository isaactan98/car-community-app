// M0 spike UI: one map, one dot (your own position), one status line,
// one start/stop button. Deliberately bare — this is a spike, not the product.

import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
} from "@maplibre/maplibre-react-native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MAP_STYLE_URL, RELAY_URL } from "./config";
import { isTracking, startTracking, stopTracking } from "./locationTask";
import { positionStore } from "./positionStore";

export default function App() {
  const position = useSyncExternalStore(
    positionStore.subscribe,
    positionStore.getPosition
  );
  const relayStatus = useSyncExternalStore(
    positionStore.subscribe,
    positionStore.getRelayStatus
  );
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isTracking().then(setTracking).catch(() => {});
  }, []);

  const toggle = async () => {
    setError(null);
    try {
      if (tracking) {
        await stopTracking();
        setTracking(false);
      } else {
        await startTracking();
        setTracking(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.container}>
      <MapLibreMap style={styles.map} mapStyle={MAP_STYLE_URL}>
        {position && (
          <>
            <Camera center={[position.lng, position.lat]} zoom={15} />
            <GeoJSONSource
              id="own-position"
              data={{
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [position.lng, position.lat],
                },
                properties: {},
              }}
            />
            <Layer
              id="own-position-dot"
              source="own-position"
              type="circle"
              paint={{
                "circle-radius": 8,
                "circle-color": "#1e88e5",
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
              }}
            />
          </>
        )}
      </MapLibreMap>

      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {tracking ? "tracking ON" : "tracking OFF"} · {relayStatus}
        </Text>
        <Text style={styles.statusText}>
          {position
            ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} @ ${new Date(position.ts).toLocaleTimeString()}`
            : "no fix yet"}
        </Text>
        <Text style={styles.statusText} numberOfLines={1}>
          {RELAY_URL}
        </Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={styles.button} onPress={toggle}>
          <Text style={styles.buttonText}>
            {tracking ? "Stop tracking" : "Start tracking"}
          </Text>
        </Pressable>
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  statusBar: {
    padding: 12,
    paddingBottom: 28,
    backgroundColor: "#111",
    gap: 2,
  },
  statusText: { color: "#eee", fontVariant: ["tabular-nums"] },
  errorText: { color: "#ff8a80" },
  button: {
    marginTop: 8,
    backgroundColor: "#1e88e5",
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
