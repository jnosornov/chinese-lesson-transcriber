import Groq from 'groq-sdk';
import { createReadStream } from 'fs';
import { stat, mkdir, writeFile, unlink } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pinyin } from 'pinyin-pro';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS_DIR = path.join(__dirname, '..', 'transcripts');
const MAX_BYTES = 24 * 1024 * 1024; // stay under Groq's 25MB limit
const CHUNK_MINUTES = 20;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

async function extractAudio(videoPath) {
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const audioPath = path.join(os.tmpdir(), `${baseName}_audio.mp3`);
  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn',          // strip video
    '-ac', '1',     // mono
    '-ar', '16000', // 16kHz sample rate (sufficient for speech)
    '-b:a', '32k',  // 32kbps bitrate
    '-y',           // overwrite if exists
    audioPath,
  ]);
  return audioPath;
}

async function getDuration(audioPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    audioPath,
  ]);
  return parseFloat(JSON.parse(stdout).format.duration);
}

async function splitAudio(audioPath, duration) {
  const chunkDuration = CHUNK_MINUTES * 60;
  const chunks = [];
  let start = 0;
  let i = 0;

  while (start < duration) {
    const chunkPath = audioPath.replace('.mp3', `_chunk${i}.mp3`);
    await execFileAsync('ffmpeg', [
      '-i', audioPath,
      '-ss', String(start),
      '-t', String(chunkDuration),
      '-c', 'copy',
      '-y',
      chunkPath,
    ]);
    chunks.push({ path: chunkPath, offset: start });
    start += chunkDuration;
    i++;
  }

  return chunks;
}

async function transcribeAudio(filePath, timeOffset = 0) {
  const response = await groq.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: 'whisper-large-v3',
    language: 'zh',
    response_format: 'verbose_json',
  });

  return (response.segments ?? [])
    .filter((seg) => seg.no_speech_prob < 0.6)
    .map((seg) => ({
      start: seg.start + timeOffset,
      text: seg.text.trim(),
    }));
}

function formatSegment({ start, text }) {
  const py = pinyin(text, { toneType: 'symbol', type: 'string' });
  return `[${formatTimestamp(start)}] ${text} (${py})`;
}

export async function transcribe(videoPath) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY must be set in .env');
  }

  await mkdir(TRANSCRIPTS_DIR, { recursive: true });

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${baseName}.txt`);

  console.log(`Extracting audio: ${path.basename(videoPath)}`);
  const audioPath = await extractAudio(videoPath);

  let allSegments = [];

  try {
    const { size } = await stat(audioPath);

    if (size <= MAX_BYTES) {
      allSegments = await transcribeAudio(audioPath);
    } else {
      console.log('Audio exceeds 24MB, splitting into 20-min chunks...');
      const duration = await getDuration(audioPath);
      const chunks = await splitAudio(audioPath, duration);

      for (const chunk of chunks) {
        console.log(`Transcribing chunk at ${formatTimestamp(chunk.offset)}...`);
        const segments = await transcribeAudio(chunk.path, chunk.offset);
        allSegments.push(...segments);
        await unlink(chunk.path);
      }
    }
  } finally {
    await unlink(audioPath).catch(() => {});
  }

  const transcript = allSegments.map(formatSegment).join('\n');
  await writeFile(transcriptPath, transcript, 'utf-8');
  console.log(`Transcript saved: ${path.basename(transcriptPath)}`);

  return transcriptPath;
}
