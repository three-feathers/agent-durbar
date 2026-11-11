/** Shared by `test-maskoutgoing.ts` and `test-maskoutgoing-fuzz.ts` (spec 095 T065): one sample per token kind, and two known values. Built at run time (push protection). */
// test-redact.ts's corpus (§3 `planted`), one sample per kind, with the part that must never survive
export const CORPUS: Array<[string, string, string]> = [
  ['ghp', 'gh' + 'p_' + 'x'.repeat(36), ''],
  ['gho', 'gh' + 'o_' + 'Y'.repeat(30), ''],
  ['github_pat', 'github' + '_pat_' + '11ABCDEFG0abcdefghij_' + 'z'.repeat(30), ''],
  ['glpat', 'gl' + 'pat-' + 'a1B2c3D4e5_f6G7-h8I9j0K', ''],
  ['sk', 's' + 'k-' + 'a1B2'.repeat(10), ''],
  ['skant', 's' + 'k-ant-api03-' + 'Q9w8'.repeat(10), ''],
  ['bearer', 'Bear' + 'er ' + 'abcdef1234567890.token-value', 'abcdef1234567890'],
  ['jwt', 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTYifQ.' + 'SflKxwRJSMeKKF2QT4fwpMeJf36', ''],
  ['aws', 'AK' + 'IA' + 'ABCDEFGH12345678', ''],
  ['authHeader', 'Authori' + 'zation: Basic ' + 'dXNlcjpw' + 'YXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
  ['urlCreds', 'https://alice:' + 'hunter2' + 'pass@example.invalid/repo.git', 'hunter2pass'],
];
export const V1 = 'hunter2-' + 'plain-value';
export const V2 = 'xyz-' + 'longer-secret-value';
