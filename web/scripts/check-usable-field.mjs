/** Sanity check for hedge stripping — keep in sync with web/src/lib/tech.ts usableField. */
const HEDGE_RE =
  /\b(likely|implied|typical|unknown|confirmed:|sales model|for some services|belum ditemukan|not disclosed|probably|maybe|derived)\b/i;
const EMPTY_RE =
  /^(unknown|n\/?a|not disclosed|undisclosed|none|-|belum ditemukan|tidak diketahui)(\b|$)/i;

function usableField(value) {
  if (!value) return "";
  const v = value.trim();
  if (!v) return "";
  if (EMPTY_RE.test(v)) return "";
  if (HEDGE_RE.test(v)) return "";
  if (v.length > 60) return "";
  return v;
}

const cases = [
  ["KVM", "KVM"],
  ["KVM (Proxmox VE)", "KVM (Proxmox VE)"],
  ["KVM (likely, OpenStack-derived)", ""],
  ["Unknown (enterprise sales model)", ""],
  ["KVM (typical for shared hosting providers)", ""],
  ["VMware vSphere (confirmed: FPT Cloud is VMware Cloud Verified); KVM for some services", ""],
  ["Belum ditemukan bukti publik yang cukup", ""],
  ["Not disclosed", ""],
  ["", ""],
  [null, ""],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = usableField(input);
  if (got !== want) {
    console.error("FAIL", JSON.stringify(input), "→", JSON.stringify(got), "want", JSON.stringify(want));
    failed++;
  }
}
if (failed) process.exit(1);
console.log(`ok ${cases.length} cases`);
