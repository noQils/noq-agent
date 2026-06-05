import { canvasColor } from './openTuiTheme';


const OSC = '\x1b]';
const BEL = '\x07';

function writeTerminalControl(sequence: string): void {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write(sequence);
}

export function applyOpenTuiTerminalBackground(): void {
  writeTerminalControl(`${OSC}11;${canvasColor}${BEL}`);
}

export function resetOpenTuiTerminalBackground(): void {
  writeTerminalControl(`${OSC}111${BEL}`);
}
