import 'dotenv/config';
import { runAgentTurn } from './workflow';

// Main function to generate content
async function main() {
  // Get the user prompt from command line arguments
  const userPrompt = process.argv.slice(2).join(' ');
  if (!userPrompt) {
    console.error('Usage: npx ts-node src/index.ts "your prompt"');
    process.exit(1);
  }

  const response = await runAgentTurn(userPrompt);
  console.log(response);
}

main();