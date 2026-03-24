import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_PATH = path.join(__dirname, '..', 'processed.json');
const VIDEO_EXTENSIONS = new Set(['.mov', '.mkv', '.mp4']);

async function loadProcessed() {
  try {
    const raw = await readFile(PROCESSED_PATH, 'utf-8');
    return new Set(JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw err;
  }
}

async function scanVideos(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await scanVideos(fullPath));
    } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function getNewFiles() {
  const inbox = process.env.INBOX_FOLDER;
  if (!inbox) throw new Error('INBOX_FOLDER must be set in .env');

  const [allFiles, processed] = await Promise.all([
    scanVideos(inbox),
    loadProcessed(),
  ]);

  return allFiles.filter((f) => !processed.has(f));
}

export async function markProcessed(filePath) {
  const processed = await loadProcessed();
  processed.add(filePath);
  await writeFile(PROCESSED_PATH, JSON.stringify([...processed], null, 2));
}