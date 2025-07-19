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
            throw new Error(`Failed to load prompt file: ${filename}`);
        }
    }

    async processChunk(jiraData, userPrompt) {
        const finalSystemPrompt = this.systemPrompt;
        const prompt = this.buildChunkPrompt(jiraData, userPrompt);
        
        return await this.makeRequestWithRetry(async () => {
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
        }, 'processChunk');
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
        const prompt = this.deduplicationPrompt.replace('{{BULLETPOINTS}}', combinedBulletpoints);
        
        return await this.makeRequestWithRetry(async () => {
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
        }, 'deduplicateBulletpoints');
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

    async reprocessAchievements(achievementsText, additionalPrompt) {
        const prompt = `Please reprocess the following achievements based on the additional instructions:

ACHIEVEMENTS:
${achievementsText}

ADDITIONAL INSTRUCTIONS:
${additionalPrompt}

Please modify the achievements according to the instructions while maintaining their professional quality and resume-worthy nature. Return only the modified achievements, one per line.`;
        
        return await this.makeRequestWithRetry(async () => {
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
        }, 'reprocessAchievements');
    }

    async makeRequestWithRetry(requestFn, operation, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                console.error(`Error in ${operation} (attempt ${attempt}/${maxRetries}):`, error.message);
                
                // Handle rate limiting specifically
                if (error.status === 429 || error.code === 'rate_limit_exceeded') {
                    if (attempt < maxRetries) {
                        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                        console.log(`Rate limit hit. Waiting ${delay}ms before retry...`);
                        await this.sleep(delay);
                        continue;
                    }
                }
                
                // Handle token limit errors
                if (error.message && error.message.includes('tokens per min')) {
                    console.error('Token limit exceeded. Consider reducing chunk size.');
                    throw new Error('Request too large: Token limit exceeded. Try processing smaller chunks.');
                }
                
                // For other errors, throw immediately
                if (attempt === maxRetries) {
                    throw error;
                }
                
                // Wait before retrying for other errors
                await this.sleep(1000 * attempt);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = AIService; 