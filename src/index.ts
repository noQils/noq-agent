import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

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
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log(text);
    } catch (error) {
        console.error('Error generating content:', error);
    }
}

main();