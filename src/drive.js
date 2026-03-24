import { google } from 'googleapis';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import 'dotenv/config';

const FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'Chinese Lessons';
const MIN_FREE_BYTES = 100 * 1024 * 1024; // 100MB minimum free space threshold

function getDriveClient(authClient) {
  return google.drive({ version: 'v3', auth: authClient });
}

async function findOrCreateFolder(drive) {
  const { data } = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });

  if (data.files.length > 0) {
    return data.files[0].id;
  }

  const { data: folder } = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  console.log(`Created Drive folder: "${FOLDER_NAME}"`);
  return folder.id;
}

async function checkQuota(drive, fileSizeBytes) {
  const { data } = await drive.about.get({ fields: 'storageQuota' });
  const { limit, usage } = data.storageQuota;

  // limit is null for Google Workspace accounts with unlimited storage
  if (!limit) return { ok: true };

  const available = parseInt(limit) - parseInt(usage);
  return {
    ok: available - fileSizeBytes > MIN_FREE_BYTES,
    availableMB: Math.round(available / 1024 / 1024),
  };
}

export async function uploadTranscript(authClient, transcriptPath) {
  const drive = getDriveClient(authClient);
  const folderId = await findOrCreateFolder(drive);
  const fileName = path.basename(transcriptPath);

  const { data: existing } = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id,webViewLink)',
  });

  if (existing.files.length > 0) {
    console.log(`Already uploaded: ${fileName}`);
    return existing.files[0].webViewLink;
  }

  const fileStats = await stat(transcriptPath);
  const { ok, availableMB } = await checkQuota(drive, fileStats.size);

  if (!ok) {
    throw new Error(`Insufficient Drive storage. Only ${availableMB}MB available.`);
  }

  const { data } = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'text/plain',
      body: createReadStream(transcriptPath),
    },
    fields: 'id,webViewLink',
  });

  console.log(`Uploaded: ${fileName}`);
  return data.webViewLink;
}