import path from 'path';
import { getAuthClient } from './auth.js';
import { transcribe } from './transcriber.js';
import { uploadTranscript } from './drive.js';
import { getNewFiles, markProcessed } from './watcher.js';
import { log } from './logger.js';
import { notify } from './notify.js';

async function processFile(authClient, videoPath) {
  const fileName = path.basename(videoPath);
  console.log(`Processing: ${fileName}`);

  const transcriptPath = await transcribe(videoPath);
  const driveLink = await uploadTranscript(authClient, transcriptPath);

  // TODO: upload video to Backblaze B2 (src/b2.js)

  await log({ videoPath, transcriptPath, driveLink });
  await markProcessed(videoPath);

  notify.success(`Transcribed: ${fileName}`);
  console.log(`Done: ${fileName}`);
}

async function main() {
  const newFiles = await getNewFiles();

  if (newFiles.length === 0) {
    console.log('No new files to process.');
    return;
  }

  console.log(`Found ${newFiles.length} new file(s).`);
  const authClient = await getAuthClient();

  for (const videoPath of newFiles) {
    try {
      await processFile(authClient, videoPath);
    } catch (err) {
      console.error(`Error processing ${path.basename(videoPath)}:`, err.message);
      notify.error(`Failed: ${path.basename(videoPath)}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  notify.error('Lesson Transcriber crashed.');
  process.exit(1);
});