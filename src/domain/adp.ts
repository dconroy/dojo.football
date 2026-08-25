/** Display ADP without exposing floating-point noise or unnecessary zeroes. */
export function formatAdp(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2).replace(/\.?0+$/, "");
}
