const OSC = '\x1b]';
const BEL = '\x07';

function writeTerminalControl(sequence: string): void {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write(sequence);
}

export function applyOpenTuiTerminalBackground(): void {
  writeTerminalControl(`${OSC}11;#1f2126${BEL}`);
}

export function resetOpenTuiTerminalBackground(): void {
  writeTerminalControl(`${OSC}111${BEL}`);
}
