/**
 * Pure semver comparison (no prerelease support — we only ship x.y.z builds).
 * Returns -1 if a<b, 0 if equal, 1 if a>b. Bad input is treated as 0.0.0.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function parseVersion(v: string): [number, number, number] {
  const parts = (v || "0.0.0").trim().split(".").map(p => {
    const n = parseInt(p.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
