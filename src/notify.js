import { execFile } from 'child_process';

const SOUNDS = {
  success: 'Glass',
  warn: 'Purr',
  error: 'Funk',
};

const TITLES = {
  success: 'Lesson Transcriber ✓',
  warn: 'Lesson Transcriber ⚠️',
  error: 'Lesson Transcriber ✗',
};

function send(type, message) {
  const title = TITLES[type];
  const sound = SOUNDS[type];
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title}" sound name "${sound}"`;

  execFile('osascript', ['-e', script], (err) => {
    if (err) {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  });
}

export const notify = {
  success: (message) => send('success', message),
  warn: (message) => send('warn', message),
  error: (message) => send('error', message),
};