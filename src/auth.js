import { google } from 'googleapis';
import { createServer } from 'http';
import { execFile } from 'child_process';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '..', 'tokens', 'google-token.json');
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function createOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  }

  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

async function saveTokens(tokens) {
  await mkdir(path.dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function loadTokens() {
  try {
    const raw = await readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function authorizeFirstTime(client) {
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('Opening browser for Google authorization...');
  execFile('open', [authUrl]);

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3000');
      const code = url.searchParams.get('code');

      if (!code) {
        res.end('No authorization code received.');
        return;
      }

      res.end('Authorization successful! You can close this tab.');
      server.close();

      try {
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);
        await saveTokens(tokens);
        console.log('Tokens saved.');
        resolve(client);
      } catch (err) {
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('Waiting for OAuth callback on http://localhost:3000 ...');
    });
  });
}

export async function getAuthClient() {
  const client = createOAuthClient();
  const tokens = await loadTokens();

  if (!tokens) {
    return authorizeFirstTime(client);
  }

  client.setCredentials(tokens);

  // Check if the refresh token is still valid
  try {
    await client.getAccessToken();
  } catch (err) {
    if (err.message?.includes('invalid_grant')) {
      console.log('Refresh token expired. Re-authorizing...');
      await unlink(TOKEN_PATH).catch(() => {});
      return authorizeFirstTime(client);
    }
    throw err;
  }

  // Persist any refreshed tokens automatically
  client.on('tokens', async (newTokens) => {
    const updated = { ...tokens, ...newTokens };
    await saveTokens(updated);
  });

  return client;
}
