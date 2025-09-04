import { PaizoScraper } from './scraper';
import { writeFile } from 'node:fs/promises';

async function main() {
  // Read credentials from environment variables (loaded via dotenvx)
  const email = process.env.PAIZO_EMAIL?.trim();
  const password = process.env.PAIZO_PASSWORD?.trim();
  // Parse CLI args: first non-flag arg is outPath; flags include --headed
  const argv = process.argv.slice(2);
  let headed = false;
  let outPath: string | undefined;
  for (const arg of argv) {
    if (arg === '--headed' || arg === '--head' || arg === '-H') {
      headed = true;
    } else if (arg.startsWith('-')) {
      // ignore unknown flags
    } else if (!outPath) {
      outPath = arg;
    }
  }
  outPath = outPath || 'paizo-data.json';

  if (!email || !password) {
    console.error(
      'Missing credentials. Please set PAIZO_EMAIL and PAIZO_PASSWORD in your environment (e.g., via dotenvx-encrypted .env) before running.\n' +
      'Example: dotenvx run -- bun run src/cli.ts [outPath] [--headed]'
    );
    process.exit(1);
  }

  const scraper = new PaizoScraper({ headed });
  try {
    const data = await scraper.scrapeData(email, password);
    await writeFile(outPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Wrote ${outPath}`);
  } finally {
    await scraper.close();
  }
}

main().catch((err) => {
  // Always log the full error to stderr; do not hide details
  console.error(err?.stack || err);

  const message = (err && typeof err === 'object' && 'message' in err)
    ? (err as any).message as string
    : String(err);

  if (message && message.includes('Login failed - invalid credentials')) {
    console.error(
      'Login failed: invalid credentials. Update your encrypted env and try again.\n' +
      'Set credentials securely with:\n' +
      '  dotenvx set PAIZO_EMAIL={{PAIZO_EMAIL}}\n' +
      '  dotenvx set PAIZO_PASSWORD={{PAIZO_PASSWORD}}\n' +
      'Then run:\n' +
      '  bun run cli\n'
    );
    process.exit(2);
  }

  if (message && (message.includes('Executable doesn\'t exist') || message.includes('download new browsers'))) {
    console.error(
      'Playwright browsers not installed. Install Firefox with:\n' +
      '  bunx playwright install firefox\n' +
      'Then run:\n' +
      '  bun run cli\n'
    );
    process.exit(3);
  }

  console.error(err?.stack || err);
  process.exit(1);
});

