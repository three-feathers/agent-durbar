/** Link filter tests: `npm run test:url` (spec 016). */
import * as assert from 'assert';
import { isHttpUrl } from '../src/shared/url';
for (const ok of ['http://a.example', 'https://a.example/x?y=1#z']) assert.ok(isHttpUrl(ok), ok);
for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'vscode://x', 'ftp://a.example', '//a.example', '/rel', 'a.example', '', null, undefined, 5, 'https://' + 'a'.repeat(5000)]) assert.ok(!isHttpUrl(bad), String(bad));
console.log('url tests passed');
