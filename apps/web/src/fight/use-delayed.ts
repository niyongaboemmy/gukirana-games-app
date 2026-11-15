import { useEffect, useState } from "react";

/** `value`, `ms` later (a change shows after the delay; P3-FGT-14: the stool lands when the second has carried it in) */
export function useDelayed<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
