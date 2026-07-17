// Tiny pub/sub bridging the background location task and the UI.
// Position = { lat, lng, ts } ONLY — never speed (spec hard constraint #1).

export type OwnPosition = { lat: number; lng: number; ts: number };

type Listener = () => void;

let latestPosition: OwnPosition | null = null;
let relayStatus = "relay: not connected";
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const positionStore = {
  getPosition: (): OwnPosition | null => latestPosition,
  getRelayStatus: (): string => relayStatus,
  setPosition(p: OwnPosition) {
    latestPosition = p;
    emit();
  },
  setRelayStatus(s: string) {
    relayStatus = s;
    emit();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
