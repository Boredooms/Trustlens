/** Client-side mirror of the server's normalisation (§4.1): lowercase, no scheme, path or wildcard, must contain a dot. */
export function normaliseDomainInput(raw: string): { value: string; error: string | null } {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0] ?? "";
  v = v.replace(/\.$/, "");
  if (!v) return { value: "", error: "Enter a domain, for example northstar-demo.example." };
  if (v.includes("*")) return { value: v, error: "Wildcards are not allowed. Claim the parent domain instead." };
  if (v.includes(":")) return { value: v, error: "Leave out the port." };
  if (!v.includes(".")) return { value: v, error: "A domain must contain a dot." };
  if (!/^[a-z0-9.-]+$/.test(v) && !/^[\p{L}\p{N}.-]+$/u.test(v)) return { value: v, error: "That does not look like a domain name." };
  if (v.length > 253) return { value: v, error: "Domains are at most 253 characters." };
  return { value: v, error: null };
}
