import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { scanDirectory } from './scanner';
import { readFileIfExists } from './fileUtils';
import path from 'node:path';

// Load environment variables
dotenv.config();

// Ensure the API key is available
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error('API_KEY is not defined in the environment variables.');
}

// Initialize the client and model
const client = new GoogleGenerativeAI(apiKey);
const model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

// Get the prompt from command line arguments
const prompt = process.argv.slice(2).join(' ');
if (!prompt) {
  console.error('Usage: npx ts-node src/index.ts "your prompt"');
  process.exit(1);
}

// Main function to generate content
async function main() {
    try {
        // Generate content based on the prompt
        const absoluteFiles = scanDirectory(process.cwd());
        const fileTree = absoluteFiles.map(file => path.relative(process.cwd(), file));
        console.log(fileTree);

        // Read package.json content if it exists
        const packageJson = readFileIfExists(path.join(process.cwd(), 'package.json'));
        const packageJsonContent = packageJson ? JSON.stringify(JSON.parse(packageJson), null, 2) : 'No package.json found';

        // Create the prompt for the model
        const promptText = `
You are a code assistant. Here is the file tree of a project:
${fileTree.join('\n')}

And here is the content of package.json:
${packageJsonContent}

The user asks: "${prompt}"

Answer briefly, focusing on what this project does and what technologies it uses.
`;
            
        const result = await model.generateContent(promptText);
        const response = await result.response;
        const text = response.text();
        console.log(text);
    } catch (error) {
        console.error('Error generating content:', error);
    }
}

main();