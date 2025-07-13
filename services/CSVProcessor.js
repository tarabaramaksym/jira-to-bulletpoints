const csv = require('csv-parser');
const { Readable } = require('stream');

class CSVProcessor {
    constructor(chunkSize = 50) {
        this.chunkSize = chunkSize; // Even smaller default for safety
        this.maxTokensPerRequest = 80000; // Conservative limit for 128k context window (leaves room for prompts + response)
        this.tokensPerCharEstimate = 0.3; // More conservative estimate: ~3.3 chars per token
    }

    async parseCsvData(csvContent, selectedFields) {
        return new Promise((resolve, reject) => {
            const results = [];
            const stream = Readable.from([csvContent]);
            
            stream
                .pipe(csv())
                .on('data', (row) => {
                    const filteredRow = {};
                    selectedFields.forEach(field => {
                        if (row.hasOwnProperty(field)) {
                            filteredRow[field] = row[field] || '';
                        }
                    });
                    
                    // Only add row if it has some content
                    if (Object.values(filteredRow).some(value => value.trim())) {
                        results.push(filteredRow);
                    }
                })
                .on('end', () => {
                    resolve(results);
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
    }

    // Helper method to get headers from CSV content
    async getHeaders(csvContent) {
        return new Promise((resolve, reject) => {
            const stream = Readable.from([csvContent]);
            let headers = [];
            
            stream
                .pipe(csv())
                .on('headers', (headerList) => {
                    headers = headerList;
                })
                .on('data', () => {
                    resolve(headers);
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
    }

    // Estimate token count for text (rough approximation)
    estimateTokens(text) {
        return Math.ceil(text.length * this.tokensPerCharEstimate);
    }

    // Estimate tokens for a chunk of data when formatted for AI
    estimateChunkTokens(chunk) {
        const formattedText = this.formatChunkForAI(chunk);
        return this.estimateTokens(formattedText);
    }

    // Create dynamic chunks based on token limits
    createChunks(data) {
        const chunks = [];
        let currentChunk = [];
        let currentTokens = 0;
        
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            
            // Estimate tokens for this record
            const recordText = Object.values(record).join(' ');
            const recordTokens = this.estimateTokens(recordText);
            
            // If adding this record would exceed token limit, start a new chunk
            if (currentChunk.length > 0 && (currentTokens + recordTokens) > this.maxTokensPerRequest) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentTokens = 0;
            }
            
            // Add record to current chunk
            currentChunk.push(record);
            currentTokens += recordTokens;
        }
        
        // Add the last chunk if it has data
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    // Legacy method for backward compatibility
    createStaticChunks(data) {
        const chunks = [];
        for (let i = 0; i < data.length; i += this.chunkSize) {
            chunks.push(data.slice(i, i + this.chunkSize));
        }
        return chunks;
    }

    formatChunkForAI(chunk) {
        let formattedData = '';
        
        chunk.forEach((item, index) => {
            formattedData += `Item ${index + 1}:\n`;
            Object.entries(item).forEach(([key, value]) => {
                if (value && value.trim()) {
                    formattedData += `- ${key}: ${value}\n`;

					if (index % 10 === 0) {
						console.log(key, value)
					}
                }
            });
            formattedData += '\n';
        });
        
        return formattedData;
    }

    formatFinalOutput(processedChunks) {
        let txtOutput = '';
        
        processedChunks.forEach(chunk => {
            const lines = chunk.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                const cleanLine = line.replace(/^[\s\-\*•]+/, '').trim();
                if (cleanLine) {
                    txtOutput += `${cleanLine}\n`;
                }
            });
        });
        
        return txtOutput;
    }

    combineChunksForDeduplication(processedChunks) {
        return processedChunks.join('\n\n');
    }

    getProcessingStats(data) {
        const totalRecords = data.length;
        const chunks = this.createChunks(data);
        const chunkCount = chunks.length;
        const avgChunkSize = chunkCount > 0 ? Math.round(totalRecords / chunkCount) : 0;
        
        // Calculate token estimates
        const totalEstimatedTokens = chunks.reduce((total, chunk) => {
            return total + this.estimateChunkTokens(chunk);
        }, 0);
        
        return {
            totalRecords,
            chunkCount,
            avgChunkSize,
            maxTokensPerChunk: this.maxTokensPerRequest,
            estimatedTotalTokens: totalEstimatedTokens,
            estimatedTokensPerChunk: chunkCount > 0 ? Math.round(totalEstimatedTokens / chunkCount) : 0,
            estimatedFields: data.length > 0 ? Object.keys(data[0]).length : 0
        };
    }
}

module.exports = CSVProcessor; 