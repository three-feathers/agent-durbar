/** Link filter tests: `npm run test:url` (spec 016). */
import * as assert from 'assert';
import { isHttpUrl } from '../src/shared/url';
for (const ok of ['http://a.example', 'https://a.example/x?y=1#z']) assert.ok(isHttpUrl(ok), ok);
for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'vscode://x', 'ftp://a.example', 'mailto:a@example.invalid', 'slack://user?team=T123&id=U123', 'msteams:/l/chat/0/0?users=a%40example.invalid', 'tel:+15550100', '//a.example', '/rel', 'a.example', '', null, undefined, 5, 'https://' + 'a'.repeat(5000)]) assert.ok(!isHttpUrl(bad), String(bad));
// spec 084 FR-040: app:openExternal stays http(s)-only; the contact links go only through contacts:open
console.log('url tests passed');
