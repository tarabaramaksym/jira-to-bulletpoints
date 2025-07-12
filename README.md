# JIRA to Bulletpoints Converter

A modern web application that converts JIRA CSV exports into organized, AI-processed bulletpoints. Transform your JIRA data into clear, actionable insights with intelligent chunking and deduplication.

## Features

### 🚀 **Core Functionality**
- **CSV Upload**: Drag & drop or click to upload JIRA CSV exports
- **Field Selection**: Choose which CSV columns to process
- **AI Processing**: Convert JIRA data into organized bulletpoints
- **Chunked Processing**: Handles large datasets (500 records per chunk)
- **Smart Deduplication**: Removes duplicate and similar bulletpoints
- **Memory-Based**: No file storage - everything processed in memory/session

### 🎨 **User Experience**
- **3-Phase Workflow**: Upload → Configure → Download
- **Progress Indicator**: Visual progress bar with step tracking
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Modern UI**: Professional gradient design with smooth animations
- **Real-time Feedback**: Loading indicators and error handling

### 🤖 **AI Integration**
- **GPT-4o-mini**: Powered by OpenAI for intelligent processing
- **Custom Prompts**: User-defined AI instructions
- **System Prompts**: Advanced configuration options
- **Template-based**: Modular prompt system with file-based templates

## Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- OpenAI API key (optional - works without AI)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd jira-to-bulletpoints
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   PORT=3000
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## Usage

### 1. **Export JIRA Data**
From JIRA, export your issues as CSV:
- Navigate to your project → Issues
- Select **Export → Export CSV (all fields)**
- Save the CSV file

### 2. **Upload and Process**
1. **Upload**: Drag & drop or click to upload your CSV file
2. **Configure**: Select which fields to process and optionally add AI prompts
3. **Process**: AI will convert your data into organized bulletpoints
4. **Download**: Get your processed CSV with bulletpoints

### 3. **Customization**
- **AI Prompt**: Add custom instructions for processing
- **System Prompt**: Advanced AI behavior configuration
- **Field Selection**: Choose specific JIRA fields to include

## Project Structure

## API Endpoints

### **Core Endpoints**
- `GET /` - Main application interface
- `POST /upload` - Upload and parse CSV file
- `POST /process` - Process CSV with AI (chunked)
- `GET /download` - Download processed results
- `POST /cleanup` - Clean up session data

### **Utility Endpoints**
- `GET /ai-status` - Check AI service status
- `GET /cleanup` - Alternative cleanup endpoint

## Processing Architecture

### **Data Flow**
```
CSV Upload → Parse & Validate → Select Fields → Create Chunks (500 records)
     ↓
Process Each Chunk with AI → Combine Results → Final Deduplication
     ↓
Format as CSV → Download
```

### **AI Processing**
1. **Chunk Processing**: Each 500-record chunk is processed individually
2. **Bulletpoint Generation**: AI converts JIRA data to organized bulletpoints
3. **Deduplication**: Final AI pass removes duplicates and generalizes similar items
4. **Formatting**: Results formatted with proper spacing (2 newlines between points)

## Configuration

### **Environment Variables**
- `OPENAI_API_KEY` - Your OpenAI API key (optional)
- `PORT` - Server port (default: 3000)

### **AI Settings**
- **Model**: GPT-4o-mini
- **Temperature**: 0.3 (consistent results)
- **Max Tokens**: 4000 per request
- **Chunk Size**: 500 records per AI request

## Development

### **Debug Mode**
Use VS Code/Cursor F5 debugging:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Launch API Server",
  "program": "${workspaceFolder}\\index.js"
}
```

### **Scripts**
- `npm start` - Production server
- `npm run dev` - Development with nodemon
- `npm test` - Run tests (placeholder)

### **Session Management**
- **Memory-based**: No file storage
- **Auto-cleanup**: Sessions cleaned after download/restart
- **Timeout**: 2-hour session expiration

## Technologies Used

### **Backend**
- **Express.js** - Web server framework
- **Multer** - File upload handling
- **Express-session** - Session management
- **OpenAI SDK** - AI integration

### **Frontend**
- **Vanilla JavaScript** - No frameworks
- **Modern CSS** - Flexbox, Grid, animations
- **Responsive Design** - Mobile-first approach

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the ISC License.

## Support

For issues or questions:
1. Check the console for error messages
2. Verify your OpenAI API key is set correctly
3. Ensure CSV files are properly formatted
4. Check browser developer tools for frontend issues

---