import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import './reader.css';

const main = document.createElement('main');
main.className = 'reader-bootstrap';

const eyebrow = document.createElement('p');
eyebrow.className = 'reader-bootstrap__eyebrow';
eyebrow.textContent = 'Sandboxed reading surface';

const heading = document.createElement('h1');
heading.textContent = 'NovelReaper';

const description = document.createElement('p');
description.textContent =
  'The isolated EPUB renderer is ready. Publication loading begins in Phase 3.';

const boundary = document.createElement('dl');
boundary.className = 'reader-bootstrap__boundary';

const terms = [
  ['Node integration', 'Off'],
  ['Context isolation', 'On'],
  ['Session', 'Ephemeral'],
] as const;

for (const [term, value] of terms) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  boundary.append(dt, dd);
}

main.append(eyebrow, heading, description, boundary);
document.body.append(main);

window.novelReaperReader.onCommand((command) => {
  if (command.type === 'ping') {
    window.novelReaperReader.report({ type: 'pong', nonce: command.nonce });
  }
  if (command.type === 'prepare-close') {
    description.textContent = 'Closing the isolated reading surface…';
  }
});

window.novelReaperReader.report({ type: 'ready', protocolVersion: 1 });
