import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const LOG_PATH = path.join(LOGS_DIR, 'activity.log');

export async function log({ videoPath, transcriptPath, driveLink }) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fileName = path.basename(videoPath);

  const entry = [
    `[${timestamp}] ${fileName}`,
    `  transcript: ${transcriptPath}`,
    `  drive: ${driveLink}`,
    '',
  ].join('\n');

  await mkdir(LOGS_DIR, { recursive: true });
  await appendFile(LOG_PATH, entry + '\n');
}