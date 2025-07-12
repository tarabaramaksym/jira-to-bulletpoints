const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

class AIService {
    constructor(apiKey) {
        this.client = new OpenAI({
            apiKey: apiKey
        });
        this.systemPrompt = this.loadPrompt('system-prompt.txt');
        this.chunkProcessingPrompt = this.loadPrompt('chunk-processing.txt');
        this.deduplicationPrompt = this.loadPrompt('deduplication.txt');
    }

    loadPrompt(filename) {
        try {
            const promptPath = path.join(__dirname, '..', 'prompts', filename);
            return fs.readFileSync(promptPath, 'utf8').trim();
        } catch (error) {
            console.error(`Error loading prompt file ${filename}:`, error);
            throw new Error(`Failed to load prompt file: ${filename}`);
        }
    }

    async processChunk(jiraData, userPrompt, systemPrompt) {
        try {
            const finalSystemPrompt = systemPrompt || this.systemPrompt;
            const prompt = this.buildChunkPrompt(jiraData, userPrompt);
            
            const response = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: finalSystemPrompt
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            });

            return response.choices[0].message.content.trim();
            
        } catch (error) {
            console.error('Error processing chunk with AI:', error);
            throw error;
        }
    }

    buildChunkPrompt(jiraData, userPrompt) {
        let prompt = this.chunkProcessingPrompt.replace('{{JIRA_DATA}}', jiraData);
        
        if (userPrompt && userPrompt.trim()) {
            prompt = prompt.replace('{{USER_PROMPT}}', `\nAdditional instructions: ${userPrompt}\n`);
        } else {
            prompt = prompt.replace('{{USER_PROMPT}}', '');
        }
        
        return prompt;
    }

    async deduplicateBulletpoints(combinedBulletpoints) {
        try {
            const prompt = this.deduplicationPrompt.replace('{{BULLETPOINTS}}', combinedBulletpoints);
            
            const response = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: this.systemPrompt
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            });

            return response.choices[0].message.content.trim();
            
        } catch (error) {
            console.error('Error deduplicating bulletpoints:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            const response = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: "Say 'AI service is working' in exactly those words."
                    }
                ],
                max_tokens: 10
            });
            
            return response.choices[0].message.content.includes('AI service is working');
        } catch (error) {
            console.error('AI service connection test failed:', error);
            return false;
        }
    }

    async generateSummary(jiraData, totalItems) {
        try {
            const prompt = `Please provide a brief summary of this JIRA data:\n\n${jiraData}\n\nTotal items: ${totalItems}`;
            
            const response = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that provides concise summaries of JIRA data."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 200
            });

            return response.choices[0].message.content.trim();
            
        } catch (error) {
            console.error('Error generating summary:', error);
            throw error;
        }
    }
}

module.exports = AIService; 