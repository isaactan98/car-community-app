import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The system Reduce Motion setting, live. Every animation in the app checks
 * this and settles to its end state instead of moving.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (mounted) setReduce(on);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
