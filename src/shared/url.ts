/** Links from chat messages: only http(s) may leave the app (checked again in the main process, not trusted from the renderer). */
export const isHttpUrl = (u: unknown): u is string => {
  if (typeof u !== 'string' || u.length > 4096) return false;
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
};
