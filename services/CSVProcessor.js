class CSVProcessor {
    constructor(chunkSize = 500) {
        this.chunkSize = chunkSize;
    }

    parseCsvData(csvContent, selectedFields) {
        const lines = csvContent.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        
        const selectedIndexes = selectedFields.map(field => headers.indexOf(field)).filter(index => index !== -1);
        
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            const row = {};
            
            selectedIndexes.forEach(index => {
                const fieldName = headers[index];
                row[fieldName] = values[index] || '';
            });
            
            if (Object.values(row).some(value => value.trim())) {
                data.push(row);
            }
        }
        
        return data;
    }

    createChunks(data) {
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
                }
            });
            formattedData += '\n';
        });
        
        return formattedData;
    }

    formatFinalOutput(processedChunks) {
        let csvOutput = 'Processed Bulletpoints\n';
        
        processedChunks.forEach(chunk => {
            const lines = chunk.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                const cleanLine = line.replace(/^[\s\-\*•]+/, '').trim();
                if (cleanLine) {
                    csvOutput += `"${cleanLine}"\n`;
                }
            });
        });
        
        return csvOutput;
    }

    combineChunksForDeduplication(processedChunks) {
        return processedChunks.join('\n\n');
    }

    getProcessingStats(data) {
        const totalRecords = data.length;
        const chunkCount = Math.ceil(totalRecords / this.chunkSize);
        
        return {
            totalRecords,
            chunkCount,
            chunkSize: this.chunkSize,
            estimatedFields: data.length > 0 ? Object.keys(data[0]).length : 0
        };
    }
}

module.exports = CSVProcessor; 