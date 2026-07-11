import { expect, test } from 'bun:test';
import { CONTENT_SECURITY_POLICY } from './content-security-policy';

test('V12: CSP loads Paizo GM images without opening other remote image origins', async () => {
  const imageDirective = CONTENT_SECURITY_POLICY
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('img-src '));
  expect(imageDirective).toBe(
    "img-src 'self' data: blob: https://paizo.com https://*.paizo.com",
  );
  expect(imageDirective).not.toContain('* ');
  expect(imageDirective).not.toContain('https: ');
  const publicIndex = Bun.file(new URL('../public/index.html', import.meta.url));
  await expect(publicIndex.text()).resolves.toContain(
    "img-src 'self' data: blob: https://paizo.com https://*.paizo.com",
  );
});
